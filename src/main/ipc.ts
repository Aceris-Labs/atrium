import { ipcMain } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import {
  listWorkspaces,
  createWorkspace,
  updateWorkspace,
  updateWorkspaces,
  deleteWorkspace,
  deleteWorkspaces,
  reorderWorkspaces,
  moveWorkspace,
  getConfig,
  setConfig,
  listWatchedPRs,
  addWatchedPR,
  removeWatchedPR,
  listWings,
  createWing,
  updateWing,
  reorderWings,
  setActiveWing,
  deleteWing,
  getWing,
} from "./store";
import { spawnSync } from "child_process";
import {
  isAbsolute,
  join as pathJoin,
  basename,
  resolve as pathResolve,
} from "path";
import { homedir } from "os";
import { getDefaultRepo } from "./github";
import { launchWorkspace, stopSession } from "./launcher";
import { generateWorkspaceDigest, generateWingSummary } from "./agent/digest";
import { detectRepo, currentBranch, listWorktrees } from "./git";
import { detectTools } from "./setup";
import { listAvailableSessions } from "./agents";
import { listDirs } from "./fs";
import {
  listConnectors,
  listConnectorStrategies,
  removeConnectorConfig,
  setConnectorConfig,
  testConnector,
  enableCloudMcp,
  disableCloudMcp,
} from "./connectors/registry";
import { startLinearOAuth } from "./oauth/linear";
import { cacheStore, orchestrator } from "./cache";
import type {
  Workspace,
  Wing,
  LaunchAction,
  ConnectorSource,
} from "../shared/types";

type IpcHandler = (
  event: IpcMainInvokeEvent,
  ...args: any[]
) => unknown | Promise<unknown>;

/**
 * Wraps `ipcMain.handle` so thrown errors are logged main-side with the
 * channel name before propagating to the renderer. The renderer's global
 * `unhandledrejection` listener then surfaces them as toasts.
 */
function safeHandle(channel: string, handler: IpcHandler): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await handler(event, ...args);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ipc:${channel}]`, err);
      throw new Error(msg);
    }
  });
}

function resolveWorktreePath(inputPath: string, baseDir: string): string {
  if (inputPath.startsWith("~/"))
    return pathJoin(homedir(), inputPath.slice(2));
  if (inputPath.startsWith("~")) return pathJoin(homedir(), inputPath.slice(1));
  if (!isAbsolute(inputPath)) return pathResolve(baseDir, inputPath);
  return inputPath;
}

export function registerIpcHandlers(): void {
  // ── Wings ────────────────────────────────────────────────────────────────
  safeHandle("wings:list", () => listWings());
  safeHandle(
    "wings:create",
    (
      _,
      data: {
        name: string;
        projectDir?: string;
        launchProfile?: LaunchAction[];
      },
    ) => createWing(data),
  );
  safeHandle("wings:update", (_, wing: Wing) => updateWing(wing));
  safeHandle("wings:reorder", (_, orderedIds: string[]) =>
    reorderWings(orderedIds),
  );
  safeHandle("wings:setActive", (_, id: string) => setActiveWing(id));
  safeHandle("wings:delete", (_, id: string) => deleteWing(id));

  // ── Workspaces (wing-scoped) ─────────────────────────────────────────────
  safeHandle("workspaces:list", (_, wingId: string) => listWorkspaces(wingId));
  safeHandle(
    "workspaces:create",
    (
      _,
      wingId: string,
      data: Omit<Workspace, "id" | "createdAt" | "updatedAt">,
    ) => createWorkspace(wingId, data),
  );
  safeHandle("workspaces:update", (_, wingId: string, workspace: Workspace) =>
    updateWorkspace(wingId, workspace),
  );
  safeHandle("workspaces:delete", (_, wingId: string, id: string) =>
    deleteWorkspace(wingId, id),
  );
  safeHandle(
    "workspaces:updateMany",
    (_, wingId: string, updates: Workspace[]) =>
      updateWorkspaces(wingId, updates),
  );
  safeHandle("workspaces:deleteMany", (_, wingId: string, ids: string[]) =>
    deleteWorkspaces(wingId, ids),
  );
  safeHandle("workspaces:reorder", (_, wingId: string, orderedIds: string[]) =>
    reorderWorkspaces(wingId, orderedIds),
  );
  safeHandle(
    "workspaces:move",
    (_, fromWingId: string, toWingId: string, id: string) =>
      moveWorkspace(fromWingId, toWingId, id),
  );

  // ── GitHub ───────────────────────────────────────────────────────────────
  // PR fetching and tmux session listing are now driven by cache refreshers
  // (see src/main/cache/). Only the wing → default-repo lookup remains as a
  // one-shot capability probe.
  safeHandle("github:defaultRepo", (_, wingId: string) =>
    getDefaultRepo(wingId),
  );

  // ── Workspace launch (wing-scoped for launch profile) ────────────────────
  safeHandle("workspace:launch", (_, wingId: string, workspace: Workspace) =>
    launchWorkspace(wingId, workspace),
  );
  safeHandle("workspace:stop", (_, workspaceId: string) =>
    stopSession(workspaceId),
  );
  safeHandle("workspace:generateDigest", (_, workspace: Workspace) =>
    generateWorkspaceDigest(workspace),
  );
  safeHandle(
    "workspace:createWorktree",
    async (
      _,
      wingId: string,
      workspaceId: string,
      params:
        | { tab: "create"; name: string; path: string }
        | { tab: "script"; command: string },
    ) => {
      const wing = getWing(wingId);
      if (!wing?.projectDir)
        throw new Error("Wing has no project directory set");
      const projectDir = resolveWorktreePath(wing.projectDir, wing.projectDir);

      const workspaces = listWorkspaces(wingId);
      const workspace = workspaces.find((w) => w.id === workspaceId);
      if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);

      let worktreePath: string;
      let worktreeName: string;

      if (params.tab === "create") {
        worktreePath = resolveWorktreePath(params.path, projectDir);
        worktreeName = params.name;

        // Try creating a new branch; fall back to checking out an existing one.
        let result = spawnSync(
          "git",
          ["worktree", "add", "-b", worktreeName, worktreePath],
          { cwd: projectDir, encoding: "utf-8" },
        );
        if (result.status !== 0) {
          result = spawnSync(
            "git",
            ["worktree", "add", worktreePath, worktreeName],
            { cwd: projectDir, encoding: "utf-8" },
          );
          if (result.status !== 0) {
            throw new Error(result.stderr?.trim() || "git worktree add failed");
          }
        }
      } else {
        const result = spawnSync("sh", ["-c", params.command], {
          cwd: projectDir,
          encoding: "utf-8",
        });
        if (result.status !== 0) {
          throw new Error(result.stderr?.trim() || "Script failed");
        }
        worktreePath = result.stdout.trim();
        if (!worktreePath) {
          throw new Error(
            "Script produced no output — expected the worktree path on stdout",
          );
        }
        // Resolve relative paths output by the script against projectDir.
        worktreePath = resolveWorktreePath(worktreePath, projectDir);
        worktreeName = basename(worktreePath);
      }

      return updateWorkspace(wingId, {
        ...workspace,
        worktree: {
          name: worktreeName,
          path: worktreePath,
          createdAt: new Date().toISOString(),
        },
      });
    },
  );

  safeHandle(
    "workspace:deleteWorktree",
    async (_, wingId: string, workspaceId: string, gitRemove: boolean) => {
      const workspaces = listWorkspaces(wingId);
      const workspace = workspaces.find((w) => w.id === workspaceId);
      if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
      if (!workspace.worktree) throw new Error("Workspace has no worktree");

      if (gitRemove) {
        const wing = getWing(wingId);
        const projectDir = wing?.projectDir
          ? resolveWorktreePath(wing.projectDir, wing.projectDir)
          : undefined;
        const result = spawnSync(
          "git",
          ["worktree", "remove", workspace.worktree.path],
          { cwd: projectDir, encoding: "utf-8" },
        );
        if (result.status !== 0) {
          throw new Error(
            result.stderr?.trim() || "git worktree remove failed",
          );
        }
      }

      const { worktree: _removed, ...rest } = workspace;
      return updateWorkspace(wingId, rest as typeof workspace);
    },
  );

  safeHandle("wing:summarize", (_, wingId: string, workspaceIds: string[]) =>
    generateWingSummary(wingId, workspaceIds),
  );

  // ── Agents ───────────────────────────────────────────────────────────────
  // Agent status + recap flow through the cache via the AgentsRefresher.
  // `agents:sessions` is kept as a one-shot capability probe for the
  // session-picker modal.
  safeHandle("agents:sessions", () => listAvailableSessions());

  // ── Watched PRs (wing-scoped) ────────────────────────────────────────────
  safeHandle("watchedPRs:list", (_, wingId: string) => listWatchedPRs(wingId));
  safeHandle(
    "watchedPRs:add",
    async (_, wingId: string, pr: { number: number; repo: string }) => {
      const result = await addWatchedPR(wingId, pr);
      void orchestrator.refreshExplicit();
      return result;
    },
  );
  safeHandle("watchedPRs:remove", async (_, wingId: string, num: number) => {
    const result = await removeWatchedPR(wingId, num);
    void orchestrator.refreshExplicit();
    return result;
  });

  // ── Config (global only) ─────────────────────────────────────────────────
  safeHandle("config:get", () => getConfig());
  safeHandle("config:set", (_, partial) => setConfig(partial));

  // ── Setup detection ──────────────────────────────────────────────────────
  safeHandle("setup:detect", () => detectTools());

  // ── Filesystem helpers (for path completion) ─────────────────────────────
  safeHandle("fs:listDirs", (_, partial: string) => listDirs(partial));

  // ── Git (directory-scoped repo detection) ────────────────────────────────
  safeHandle("git:detectRepo", (_, dirPath: string) => detectRepo(dirPath));
  safeHandle("git:currentBranch", (_, dirPath: string) =>
    currentBranch(dirPath),
  );
  safeHandle("git:listWorktrees", (_, dirPath: string) =>
    listWorktrees(dirPath),
  );

  // ── Connectors ───────────────────────────────────────────────────────────
  safeHandle("connectors:list", () => listConnectors());
  safeHandle("connectors:strategies", (_, source: ConnectorSource) =>
    listConnectorStrategies(source),
  );
  safeHandle("connectors:set", (_, source: ConnectorSource, config: unknown) =>
    setConnectorConfig(source, config),
  );
  safeHandle("connectors:remove", (_, source: ConnectorSource) =>
    removeConnectorConfig(source),
  );
  safeHandle(
    "connectors:test",
    (_, source: ConnectorSource, config?: unknown) =>
      testConnector(source, config),
  );
  safeHandle("connectors:cloud-mcp:enable", (_, source: ConnectorSource) =>
    enableCloudMcp(source),
  );
  safeHandle("connectors:cloud-mcp:disable", (_, source: ConnectorSource) =>
    disableCloudMcp(source),
  );
  safeHandle("connectors:oauth", async (_, source: ConnectorSource) => {
    if (source !== "linear") {
      return { ok: false, error: "OAuth not supported for this connector" };
    }
    try {
      const { oauthToken } = await startLinearOAuth();
      const config = { oauthToken };
      const result = await testConnector(source, config);
      if (result.ok) setConnectorConfig(source, config);
      return result;
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "OAuth failed",
      };
    }
  });

  // ── Cache bridge (renderer mirror) ───────────────────────────────────────
  safeHandle("cache:snapshot", () => cacheStore.snapshot());
  safeHandle("cache:setActiveWing", (_, wingId: string | null) =>
    orchestrator.setActiveWing(wingId),
  );
  safeHandle("cache:refreshAll", () => orchestrator.refreshAll());
  safeHandle("cache:refreshPRs", () => orchestrator.refreshPRs());
  safeHandle("cache:refreshExplicit", () => orchestrator.refreshExplicit());
  safeHandle("cache:requestPRRefresh", (_, repo: string, number: number) =>
    orchestrator.refreshPRKey(repo, number),
  );
  safeHandle("cache:requestLinkRefresh", (_, url: string) =>
    orchestrator.refreshLink(url),
  );
}

import { ipcMain } from "electron";
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
import {
  listMyPRs,
  listReviewRequests,
  listTmuxSessions,
  fetchPR,
  getDefaultRepo,
} from "./github";
import { launchWorkspace, stopSession } from "./launcher";
import { generateWorkspaceDigest, generateWingSummary } from "./agent/digest";
import { detectRepo, currentBranch, listWorktrees } from "./git";
import { detectTools } from "./setup";
import {
  getAgentStatuses,
  getSessionRecap,
  listAvailableSessions,
} from "./agents";
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
import { hydrateLinks, refreshLink, getCachedLinks } from "./linkHydration";
import type {
  Workspace,
  Wing,
  LaunchAction,
  ConnectorSource,
  AgentSessionInfo,
  PRStatus,
  LinkStatus,
} from "../shared/types";

function resolveWorktreePath(inputPath: string, baseDir: string): string {
  if (inputPath.startsWith("~/"))
    return pathJoin(homedir(), inputPath.slice(2));
  if (inputPath.startsWith("~")) return pathJoin(homedir(), inputPath.slice(1));
  if (!isAbsolute(inputPath)) return pathResolve(baseDir, inputPath);
  return inputPath;
}

export function registerIpcHandlers(): void {
  // ── Wings ────────────────────────────────────────────────────────────────
  ipcMain.handle("wings:list", () => listWings());
  ipcMain.handle(
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
  ipcMain.handle("wings:update", (_, wing: Wing) => updateWing(wing));
  ipcMain.handle("wings:reorder", (_, orderedIds: string[]) =>
    reorderWings(orderedIds),
  );
  ipcMain.handle("wings:setActive", (_, id: string) => setActiveWing(id));
  ipcMain.handle("wings:delete", (_, id: string) => deleteWing(id));

  // ── Workspaces (wing-scoped) ─────────────────────────────────────────────
  ipcMain.handle("workspaces:list", (_, wingId: string) =>
    listWorkspaces(wingId),
  );
  ipcMain.handle(
    "workspaces:create",
    (
      _,
      wingId: string,
      data: Omit<Workspace, "id" | "createdAt" | "updatedAt">,
    ) => createWorkspace(wingId, data),
  );
  ipcMain.handle(
    "workspaces:update",
    (_, wingId: string, workspace: Workspace) =>
      updateWorkspace(wingId, workspace),
  );
  ipcMain.handle("workspaces:delete", (_, wingId: string, id: string) =>
    deleteWorkspace(wingId, id),
  );
  ipcMain.handle(
    "workspaces:updateMany",
    (_, wingId: string, updates: Workspace[]) =>
      updateWorkspaces(wingId, updates),
  );
  ipcMain.handle(
    "workspaces:deleteMany",
    (_, wingId: string, ids: string[]) => deleteWorkspaces(wingId, ids),
  );
  ipcMain.handle(
    "workspaces:reorder",
    (_, wingId: string, orderedIds: string[]) =>
      reorderWorkspaces(wingId, orderedIds),
  );
  ipcMain.handle(
    "workspaces:move",
    (_, fromWingId: string, toWingId: string, id: string) =>
      moveWorkspace(fromWingId, toWingId, id),
  );

  // ── GitHub ───────────────────────────────────────────────────────────────
  ipcMain.handle("github:myPRs", (_, wingId: string) => listMyPRs(wingId));
  ipcMain.handle("github:reviewRequests", (_, wingId: string) =>
    listReviewRequests(wingId),
  );
  ipcMain.handle("github:tmuxSessions", () => listTmuxSessions());
  ipcMain.handle("github:fetchPR", (_, repo: string, number: number) =>
    fetchPR(repo, number),
  );
  ipcMain.handle("github:defaultRepo", (_, wingId: string) =>
    getDefaultRepo(wingId),
  );

  // ── Workspace launch (wing-scoped for launch profile) ────────────────────
  ipcMain.handle(
    "workspace:launch",
    (_, wingId: string, workspace: Workspace) =>
      launchWorkspace(wingId, workspace),
  );
  ipcMain.handle("workspace:stop", (_, workspaceId: string) =>
    stopSession(workspaceId),
  );
  ipcMain.handle(
    "workspace:generateDigest",
    (
      _,
      workspace: Workspace,
      prStatuses: PRStatus[],
      linkStatuses: Record<string, LinkStatus>,
    ) => generateWorkspaceDigest(workspace, prStatuses, linkStatuses),
  );
  ipcMain.handle(
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

  ipcMain.handle(
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

  ipcMain.handle(
    "wing:summarize",
    (_, wingId: string, workspaceIds: string[]) =>
      generateWingSummary(wingId, workspaceIds),
  );

  // ── Agents ───────────────────────────────────────────────────────────────
  ipcMain.handle(
    "agents:statuses",
    (_, sessions: Record<string, AgentSessionInfo | undefined>) =>
      getAgentStatuses(sessions),
  );
  ipcMain.handle("agents:sessions", () => listAvailableSessions());
  ipcMain.handle(
    "agents:recap",
    (_, info: AgentSessionInfo | undefined) => getSessionRecap(info),
  );

  // ── Watched PRs (wing-scoped) ────────────────────────────────────────────
  ipcMain.handle("watchedPRs:list", (_, wingId: string) =>
    listWatchedPRs(wingId),
  );
  ipcMain.handle(
    "watchedPRs:add",
    (_, wingId: string, pr: { number: number; repo: string }) =>
      addWatchedPR(wingId, pr),
  );
  ipcMain.handle("watchedPRs:remove", (_, wingId: string, num: number) =>
    removeWatchedPR(wingId, num),
  );

  // ── Config (global only) ─────────────────────────────────────────────────
  ipcMain.handle("config:get", () => getConfig());
  ipcMain.handle("config:set", (_, partial) => setConfig(partial));

  // ── Setup detection ──────────────────────────────────────────────────────
  ipcMain.handle("setup:detect", () => detectTools());

  // ── Filesystem helpers (for path completion) ─────────────────────────────
  ipcMain.handle("fs:listDirs", (_, partial: string) => listDirs(partial));

  // ── Git (directory-scoped repo detection) ────────────────────────────────
  ipcMain.handle("git:detectRepo", (_, dirPath: string) => detectRepo(dirPath));
  ipcMain.handle("git:currentBranch", (_, dirPath: string) =>
    currentBranch(dirPath),
  );
  ipcMain.handle("git:listWorktrees", (_, dirPath: string) =>
    listWorktrees(dirPath),
  );

  // ── Connectors ───────────────────────────────────────────────────────────
  ipcMain.handle("connectors:list", () => listConnectors());
  ipcMain.handle("connectors:strategies", (_, source: ConnectorSource) =>
    listConnectorStrategies(source),
  );
  ipcMain.handle(
    "connectors:set",
    (_, source: ConnectorSource, config: unknown) =>
      setConnectorConfig(source, config),
  );
  ipcMain.handle("connectors:remove", (_, source: ConnectorSource) =>
    removeConnectorConfig(source),
  );
  ipcMain.handle(
    "connectors:test",
    (_, source: ConnectorSource, config?: unknown) =>
      testConnector(source, config),
  );
  ipcMain.handle("connectors:cloud-mcp:enable", (_, source: ConnectorSource) =>
    enableCloudMcp(source),
  );
  ipcMain.handle("connectors:cloud-mcp:disable", (_, source: ConnectorSource) =>
    disableCloudMcp(source),
  );
  ipcMain.handle("connectors:oauth", async (_, source: ConnectorSource) => {
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

  // ── Link hydration ───────────────────────────────────────────────────────
  ipcMain.handle("links:getCached", (_, urls: string[]) =>
    getCachedLinks(urls),
  );
  ipcMain.handle("links:hydrate", (_, urls: string[]) => hydrateLinks(urls));
  ipcMain.handle("links:refresh", (_, url: string) => refreshLink(url));
}

import { ipcMain } from "electron";
import {
  listWorkspaces,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
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
} from "./store";
import {
  listMyPRs,
  listReviewRequests,
  listTmuxSessions,
  fetchPR,
  getDefaultRepo,
} from "./github";
import { launchWorkspace, stopSession } from "./launcher";
import { detectRepo, checkoutBranch } from "./git";
import { detectTools } from "./setup";
import { getAgentStatuses, listAvailableSessions } from "./agents";
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
} from "../shared/types";

export function registerIpcHandlers(): void {
  // ── Wings ────────────────────────────────────────────────────────────────
  ipcMain.handle("wings:list", () => listWings());
  ipcMain.handle(
    "wings:create",
    (
      _,
      data: { name: string; rootDir?: string; launchProfile?: LaunchAction[] },
    ) => createWing(data),
  );
  ipcMain.handle("wings:update", (_, wing: Wing) => updateWing(wing));
  ipcMain.handle("wings:reorder", (_, orderedIds: string[]) =>
    reorderWings(orderedIds),
  );
  ipcMain.handle("wings:setActive", (_, id: string) => setActiveWing(id));

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

  // ── Agents ───────────────────────────────────────────────────────────────
  ipcMain.handle(
    "agents:statuses",
    (_, sessions: Record<string, AgentSessionInfo | undefined>) =>
      getAgentStatuses(sessions),
  );
  ipcMain.handle("agents:sessions", () => listAvailableSessions());

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

  // ── Git (directory-scoped repo detection + branch checkout) ─────────────
  ipcMain.handle("git:detectRepo", (_, dirPath: string) => detectRepo(dirPath));
  ipcMain.handle("git:checkoutBranch", (_, dirPath: string, branch: string) =>
    checkoutBranch(dirPath, branch),
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

import { contextBridge, ipcRenderer, shell } from "electron";
import type {
  Workspace,
  Wing,
  WindowApi,
  LaunchAction,
  ConnectorSource,
  AgentSessionInfo,
  PRStatus,
  LinkStatus,
} from "../shared/types";
import type { CacheEvent } from "../shared/cacheTypes";

const api: WindowApi = {
  wings: {
    list: () => ipcRenderer.invoke("wings:list"),
    create: (data: {
      name: string;
      projectDir?: string;
      launchProfile?: LaunchAction[];
    }) => ipcRenderer.invoke("wings:create", data),
    update: (wing: Wing) => ipcRenderer.invoke("wings:update", wing),
    reorder: (orderedIds: string[]) =>
      ipcRenderer.invoke("wings:reorder", orderedIds),
    setActive: (id: string) => ipcRenderer.invoke("wings:setActive", id),
    delete: (id: string) => ipcRenderer.invoke("wings:delete", id),
  },
  workspaces: {
    list: (wingId: string) => ipcRenderer.invoke("workspaces:list", wingId),
    create: (wingId, data) =>
      ipcRenderer.invoke("workspaces:create", wingId, data),
    update: (wingId, workspace) =>
      ipcRenderer.invoke("workspaces:update", wingId, workspace),
    delete: (wingId, id) => ipcRenderer.invoke("workspaces:delete", wingId, id),
    updateMany: (wingId, updates) =>
      ipcRenderer.invoke("workspaces:updateMany", wingId, updates),
    deleteMany: (wingId, ids) =>
      ipcRenderer.invoke("workspaces:deleteMany", wingId, ids),
    reorder: (wingId, orderedIds) =>
      ipcRenderer.invoke("workspaces:reorder", wingId, orderedIds),
    move: (fromWingId, toWingId, id) =>
      ipcRenderer.invoke("workspaces:move", fromWingId, toWingId, id),
  },
  github: {
    defaultRepo: (wingId: string) =>
      ipcRenderer.invoke("github:defaultRepo", wingId),
  },
  workspace: {
    launch: (wingId: string, workspace: Workspace) =>
      ipcRenderer.invoke("workspace:launch", wingId, workspace),
    stop: (workspaceId: string) =>
      ipcRenderer.invoke("workspace:stop", workspaceId),
    generateDigest: (workspace: Workspace) =>
      ipcRenderer.invoke("workspace:generateDigest", workspace),
    createWorktree: (
      wingId: string,
      workspaceId: string,
      params:
        | { tab: "create"; name: string; path: string }
        | { tab: "script"; command: string },
    ) =>
      ipcRenderer.invoke(
        "workspace:createWorktree",
        wingId,
        workspaceId,
        params,
      ),
    deleteWorktree: (wingId: string, workspaceId: string, gitRemove: boolean) =>
      ipcRenderer.invoke(
        "workspace:deleteWorktree",
        wingId,
        workspaceId,
        gitRemove,
      ),
  },
  wing: {
    summarize: (wingId: string, workspaceIds: string[]) =>
      ipcRenderer.invoke("wing:summarize", wingId, workspaceIds),
  },
  shell: {
    openExternal: (url: string) => shell.openExternal(url),
  },
  events: {
    onDataChanged: (handler: () => void) => {
      const wrapped = () => handler();
      ipcRenderer.on("data:changed", wrapped);
      return () => {
        ipcRenderer.removeListener("data:changed", wrapped);
      };
    },
  },
  agents: {
    sessions: () => ipcRenderer.invoke("agents:sessions"),
  },
  watchedPRs: {
    list: (wingId: string) => ipcRenderer.invoke("watchedPRs:list", wingId),
    add: (wingId: string, pr: { number: number; repo: string }) =>
      ipcRenderer.invoke("watchedPRs:add", wingId, pr),
    remove: (wingId: string, num: number) =>
      ipcRenderer.invoke("watchedPRs:remove", wingId, num),
  },
  config: {
    get: () => ipcRenderer.invoke("config:get"),
    set: (partial: object) => ipcRenderer.invoke("config:set", partial),
  },
  setup: {
    detect: () => ipcRenderer.invoke("setup:detect"),
  },
  git: {
    detectRepo: (dirPath: string) =>
      ipcRenderer.invoke("git:detectRepo", dirPath),
    currentBranch: (dirPath: string) =>
      ipcRenderer.invoke("git:currentBranch", dirPath),
    listWorktrees: (dirPath: string) =>
      ipcRenderer.invoke("git:listWorktrees", dirPath),
  },
  fs: {
    listDirs: (partial: string) => ipcRenderer.invoke("fs:listDirs", partial),
  },
  connectors: {
    list: () => ipcRenderer.invoke("connectors:list"),
    strategies: (source: ConnectorSource) =>
      ipcRenderer.invoke("connectors:strategies", source),
    set: (source: ConnectorSource, config: unknown) =>
      ipcRenderer.invoke("connectors:set", source, config),
    remove: (source: ConnectorSource) =>
      ipcRenderer.invoke("connectors:remove", source),
    test: (source: ConnectorSource, config?: unknown) =>
      ipcRenderer.invoke("connectors:test", source, config),
    startOAuth: (source: ConnectorSource) =>
      ipcRenderer.invoke("connectors:oauth", source),
    enableCloudMcp: (source: ConnectorSource) =>
      ipcRenderer.invoke("connectors:cloud-mcp:enable", source),
    disableCloudMcp: (source: ConnectorSource) =>
      ipcRenderer.invoke("connectors:cloud-mcp:disable", source),
  },
  cache: {
    snapshot: () => ipcRenderer.invoke("cache:snapshot"),
    setActiveWing: (wingId: string | null) =>
      ipcRenderer.invoke("cache:setActiveWing", wingId),
    refreshAll: () => ipcRenderer.invoke("cache:refreshAll"),
    refreshLinked: () => ipcRenderer.invoke("cache:refreshLinked"),
    requestPRRefresh: (repo: string, number: number) =>
      ipcRenderer.invoke("cache:requestPRRefresh", repo, number),
    requestLinkRefresh: (url: string) =>
      ipcRenderer.invoke("cache:requestLinkRefresh", url),
    onEvent: (handler: (event: CacheEvent) => void) => {
      const wrapped = (_: unknown, event: CacheEvent) => handler(event);
      ipcRenderer.on("cache:event", wrapped);
      return () => {
        ipcRenderer.removeListener("cache:event", wrapped);
      };
    },
  },
};

contextBridge.exposeInMainWorld("api", api);

export interface WorkspacePR {
  repo: string; // "owner/repo"
  number: number;
}

export interface WorkspaceDigest {
  text: string;
  generatedAt: string;
}

export interface Workspace {
  id: string;
  title: string;
  type: "feature" | "research" | "bug";
  status: "active" | "blocked" | "done" | "archived";
  groupId?: string; // if set, pinned to a custom group; otherwise auto-bucketed by status
  repo?: string; // "owner/repo" — the primary/default repo for this workspace
  branch?: string;
  directoryPath?: string; // absolute path to the space's working directory (may be a plain dir, a git repo, or a worktree)
  prs: WorkspacePR[]; // PRs tracked by this workspace (repo-qualified)
  tmuxSession?: string; // linked tmux session name (for agent status tracking)
  claudeSessionId?: string; // Claude Code session UUID (captured after first launch; used for --resume)
  todos: TodoItem[];
  notes: NoteItem[];
  links: WorkspaceLink[];
  about?: string; // user-written description
  digest?: WorkspaceDigest; // agent-generated summary
  createdAt: string;
  updatedAt: string;
}

export interface PRStatus {
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  url: string;
  isDraft: boolean;
  ciStatus: "pending" | "success" | "failure" | "unknown";
  reviewDecision: "APPROVED" | "REVIEW_REQUIRED" | "CHANGES_REQUESTED" | null;
  openComments: number;
  mergeState?:
    | "CLEAN"
    | "BLOCKED"
    | "BEHIND"
    | "QUEUED"
    | "UNSTABLE"
    | "UNKNOWN";
  autoMerge?: boolean;
  author?: string;
  repo?: string;
}

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

export interface NoteItem {
  id: string;
  text: string;
  createdAt: string;
}

export type LinkCategory = "docs" | "tickets" | "other";

export interface WorkspaceLink {
  id: string;
  url: string;
  label: string;
  source:
    | "notion"
    | "linear"
    | "github"
    | "slack"
    | "discord"
    | "figma"
    | "jira"
    | "confluence"
    | "coda"
    | "other";
  category: LinkCategory;
}

// ── Link hydration ─────────────────────────────────────────────────────────
export type LinkStatusKind =
  | "open"
  | "in-progress"
  | "done"
  | "blocked"
  | "unknown";

export type LinkStatusError =
  | "auth"
  | "not-found"
  | "forbidden"
  | "network"
  | "rate-limited"
  | "unsupported"
  | "not-configured";

export interface LinkStatus {
  title?: string;
  status?: string;
  statusKind?: LinkStatusKind;
  icon?: string;
  assignee?: string;
  updatedAt?: string;
  error?: LinkStatusError;
  fetchedAt: string;
  // enriched metadata
  identifier?: string; // Linear/Jira key (e.g. "ABC-123")
  subtitle?: string; // Slack channel, Confluence space, Notion parent, Coda doc
  priority?: string; // "urgent" / "high" / Jira priority name
  priorityIcon?: string; // Jira priority iconUrl
  labels?: string[]; // Linear labels, Jira labels
  thumbnailUrl?: string; // Figma thumbnail, Notion cover
  authorName?: string; // last editor / Slack user / version.by
  commentCount?: number; // Linear comments.totalCount, Slack reply_count
  reactions?: Array<{ name: string; count: number }>; // Slack
}

// ── Connectors ─────────────────────────────────────────────────────────────
export type ConnectorSource =
  | "linear"
  | "jira"
  | "confluence"
  | "slack"
  | "discord"
  | "coda"
  | "figma"
  | "notion"
  | "github"
  | "claude";

export interface NotionConfig {
  apiToken: string;
}

export interface LinearConfig {
  apiKey?: string;
  oauthToken?: string;
}

export interface AtlassianConfig {
  domain: string;
  email: string;
  apiToken: string;
}

export type JiraConfig = AtlassianConfig;
export type ConfluenceConfig = AtlassianConfig;

export interface SlackConfig {
  botToken: string;
}

export interface DiscordConfig {
  botToken: string;
}

export interface CodaConfig {
  apiToken: string;
}

export interface FigmaConfig {
  personalAccessToken: string;
}

/**
 * "mcp"       — local stdio MCP server found in ~/.claude/settings.json or ~/.mcp.json
 * "cloud-mcp" — claude.ai cloud-managed MCP (e.g. Linear, Notion, Slack integrations);
 *               hydrated by spawning `claude -p` and letting it call its cloud tools
 * "api-key"   — direct API call with a stored credential
 * "oauth"     — OAuth token (Linear only)
 * "agent"     — generic claude subprocess fallback (no specific MCP tool)
 * "gh-cli"    — GitHub CLI (`gh`) with its own stored authentication
 */
export type ConnectorStrategy =
  | "mcp"
  | "cloud-mcp"
  | "api-key"
  | "oauth"
  | "agent"
  | "gh-cli";

export interface StrategyStatus {
  strategy: ConnectorStrategy;
  /** Whether this strategy is available to use (e.g. MCP server found in config) */
  available: boolean;
  /** Whether credentials/connection are configured and working */
  configured: boolean;
  /** Human-readable description (e.g. "via linear in Claude Code") */
  detail?: string;
}

export interface ConnectorStatus {
  source: ConnectorSource;
  configured: boolean;
  /** Active strategy in use — determined by priority: mcp > api-key/oauth */
  activeStrategy?: ConnectorStrategy;
  maskedKey?: string;
  publicFields?: Record<string, string>;
}

export type ConnectorTestResult =
  | { ok: true; identity?: string }
  | { ok: false; error: string };

export interface TmuxPane {
  command?: string; // "${claude}" expands to the full claude CLI invocation
  split?: "h" | "v"; // how to split to create this pane (first pane omits this)
  size?: number; // split percentage (e.g. 40 → -p 40)
  focus?: boolean; // move focus here after layout is built
}

export type LaunchAction =
  | { type: "editor"; app: "cursor" | "code" }
  | {
      type: "terminal-tmux";
      app: "ghostty" | "iterm" | "terminal" | "warp";
      panes?: TmuxPane[];
    }
  | {
      type: "terminal-cmd";
      app: "ghostty" | "iterm" | "terminal" | "warp";
      command: string;
    };

export interface Wing {
  id: string;
  name: string;
  rootDir?: string;
  // undefined → inherit the global defaultLaunchProfile
  launchProfile?: LaunchAction[];
  /** User-created groups (in addition to auto status groups) */
  customGroups?: { id: string; name: string }[];
  /** Ordered list of group IDs — status IDs ("active","blocked","done","archived") + custom group IDs */
  groupOrder?: string[];
  createdAt: string;
}

export interface AgentSessionInfo {
  tmuxSession?: string;
  directoryPath?: string;
  claudeSessionId?: string;
}

export interface AtriumConfig {
  ghPath: string;
  setupComplete: boolean;
  defaultLaunchProfile: LaunchAction[];
  wingOrder: string[];
  activeWingId: string | null;
}

export interface ToolStatus {
  installed: boolean;
  path?: string;
  version?: string;
  authenticated?: boolean;
  username?: string;
}

export interface DetectedTools {
  gh: ToolStatus;
  claude: ToolStatus;
  editors: { cursor: ToolStatus; code: ToolStatus };
  terminals: {
    ghostty: ToolStatus;
    iterm: ToolStatus;
    terminal: ToolStatus;
    warp: ToolStatus;
  };
}

export interface RepoInfo {
  path: string;
  repo: string; // owner/repo
}

export interface DirMatch {
  name: string;
  fullPath: string;
}

export interface GitRepoInfo {
  isRepo: boolean;
  currentBranch?: string;
  branches?: string[];
}

export type GitCheckoutResult = { ok: true } | { ok: false; error: string };

export type WindowApi = {
  wings: {
    list: () => Promise<Wing[]>;
    create: (data: {
      name: string;
      rootDir?: string;
      launchProfile?: LaunchAction[];
    }) => Promise<Wing>;
    update: (wing: Wing) => Promise<Wing>;
    reorder: (orderedIds: string[]) => Promise<void>;
    setActive: (id: string) => Promise<void>;
  };
  workspaces: {
    list: (wingId: string) => Promise<Workspace[]>;
    create: (
      wingId: string,
      w: Omit<Workspace, "id" | "createdAt" | "updatedAt">,
    ) => Promise<Workspace>;
    update: (wingId: string, w: Workspace) => Promise<Workspace>;
    delete: (wingId: string, id: string) => Promise<void>;
    move: (
      fromWingId: string,
      toWingId: string,
      id: string,
    ) => Promise<Workspace>;
  };
  github: {
    myPRs: (wingId: string) => Promise<PRStatus[]>;
    reviewRequests: (wingId: string) => Promise<PRStatus[]>;
    tmuxSessions: () => Promise<string[]>;
    fetchPR: (repo: string, number: number) => Promise<PRStatus | null>;
    defaultRepo: (wingId: string) => Promise<string | null>;
  };
  workspace: {
    launch: (wingId: string, w: Workspace) => Promise<string>; // returns tmux session name
    stop: (workspaceId: string) => Promise<void>;
    generateDigest: (
      workspace: Workspace,
      prStatuses: PRStatus[],
      linkStatuses: Record<string, LinkStatus>,
    ) => Promise<string>;
  };
  wing: {
    summarize: (
      workspaces: Workspace[],
      prStatuses: PRStatus[],
      linkStatuses: Record<string, LinkStatus>,
    ) => Promise<string>;
  };
  agents: {
    statuses: (
      sessions: Record<string, AgentSessionInfo | undefined>,
    ) => Promise<
      Record<string, "working" | "needs-input" | "idle" | "no-session">
    >;
    sessions: () => Promise<{ name: string; status: string }[]>;
  };
  shell: {
    openExternal: (url: string) => Promise<void>;
  };
  watchedPRs: {
    list: (wingId: string) => Promise<{ number: number; repo: string }[]>;
    add: (
      wingId: string,
      pr: { number: number; repo: string },
    ) => Promise<{ number: number; repo: string }[]>;
    remove: (
      wingId: string,
      num: number,
    ) => Promise<{ number: number; repo: string }[]>;
  };
  config: {
    get: () => Promise<AtriumConfig>;
    set: (config: Partial<AtriumConfig>) => Promise<AtriumConfig>;
  };
  setup: {
    detect: () => Promise<DetectedTools>;
  };
  git: {
    detectRepo: (dirPath: string) => Promise<GitRepoInfo>;
    checkoutBranch: (
      dirPath: string,
      branch: string,
    ) => Promise<GitCheckoutResult>;
  };
  fs: {
    listDirs: (partial: string) => Promise<DirMatch[]>;
  };
  connectors: {
    list: () => Promise<ConnectorStatus[]>;
    strategies: (source: ConnectorSource) => Promise<StrategyStatus[]>;
    set: (source: ConnectorSource, config: unknown) => Promise<void>;
    remove: (source: ConnectorSource) => Promise<void>;
    test: (
      source: ConnectorSource,
      config?: unknown,
    ) => Promise<ConnectorTestResult>;
    startOAuth: (source: ConnectorSource) => Promise<ConnectorTestResult>;
    enableCloudMcp: (source: ConnectorSource) => Promise<void>;
    disableCloudMcp: (source: ConnectorSource) => Promise<void>;
  };
  links: {
    getCached: (urls: string[]) => Promise<Record<string, LinkStatus>>;
    hydrate: (urls: string[]) => Promise<Record<string, LinkStatus>>;
    refresh: (url: string) => Promise<LinkStatus>;
  };
};

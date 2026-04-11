export interface Workspace {
  id: string
  title: string
  type: 'note' | 'task' | 'project'
  status: 'active' | 'blocked' | 'done' | 'archived'
  repo?: string // "owner/repo"
  branch?: string
  worktreePath?: string // absolute path to git worktree
  prs: number[] // PR numbers tracked by this workspace
  tmuxSession?: string // linked tmux session name (for agent status tracking)
  todos: TodoItem[]
  notes: NoteItem[]
  links: WorkspaceLink[]
  createdAt: string
  updatedAt: string
}

export interface PRStatus {
  number: number
  title: string
  state: 'open' | 'closed' | 'merged'
  url: string
  isDraft: boolean
  ciStatus: 'pending' | 'success' | 'failure' | 'unknown'
  reviewDecision: 'APPROVED' | 'REVIEW_REQUIRED' | 'CHANGES_REQUESTED' | null
  openComments: number
  mergeState?: 'CLEAN' | 'BLOCKED' | 'BEHIND' | 'QUEUED' | 'UNSTABLE' | 'UNKNOWN'
  autoMerge?: boolean
  author?: string
  repo?: string
}

export interface TodoItem {
  id: string
  text: string
  done: boolean
}

export interface NoteItem {
  id: string
  text: string
  createdAt: string
}

export type LinkCategory = 'docs' | 'tickets' | 'other'

export interface WorkspaceLink {
  id: string
  url: string
  label: string
  source: 'notion' | 'linear' | 'github' | 'slack' | 'figma' | 'jira' | 'other'
  category: LinkCategory
}

export type LaunchAction =
  | { type: 'editor'; app: 'cursor' | 'code' }
  | { type: 'terminal-tmux'; app: 'ghostty' | 'iterm' | 'terminal' | 'warp' }
  | { type: 'terminal-cmd'; app: 'ghostty' | 'iterm' | 'terminal' | 'warp'; command: string }

export interface AtriumConfig {
  launchProfile: LaunchAction[]
  ghPath: string
  rootDir?: string
  setupComplete: boolean
}

export interface ToolStatus {
  installed: boolean
  path?: string
  version?: string
  authenticated?: boolean
  username?: string
}

export interface DetectedTools {
  gh: ToolStatus
  claude: ToolStatus
  editors: { cursor: ToolStatus; code: ToolStatus }
  terminals: { ghostty: ToolStatus; iterm: ToolStatus; terminal: ToolStatus; warp: ToolStatus }
}

export interface RepoInfo {
  path: string
  repo: string // owner/repo
}

export interface WorktreeInfo {
  path: string        // absolute path
  displayPath: string // ~ shortened
  branch: string
  repoName: string    // e.g. "mono-repo"
}

export type WindowApi = {
  workspaces: {
    list: () => Promise<Workspace[]>
    create: (w: Omit<Workspace, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Workspace>
    update: (w: Workspace) => Promise<Workspace>
    delete: (id: string) => Promise<void>
  }
  github: {
    myPRs: (repo?: string) => Promise<PRStatus[]>
    reviewRequests: () => Promise<PRStatus[]>
    tmuxSessions: () => Promise<string[]>
    fetchPR: (repo: string, number: number) => Promise<PRStatus | null>
    defaultRepo: () => Promise<string | null>
  }
  workspace: {
    launch: (w: Workspace) => Promise<string> // returns tmux session name
    stop: (workspaceId: string) => Promise<void>
  }
  agents: {
    statuses: (sessions: Record<string, string | undefined>) => Promise<Record<string, 'working' | 'needs-input' | 'idle' | 'no-session'>>
    sessions: () => Promise<{ name: string; status: string }[]>
  }
  shell: {
    openExternal: (url: string) => Promise<void>
  }
  watchedPRs: {
    list: () => Promise<{ number: number; repo: string }[]>
    add: (pr: { number: number; repo: string }) => Promise<{ number: number; repo: string }[]>
    remove: (num: number) => Promise<{ number: number; repo: string }[]>
  }
  config: {
    get: () => Promise<AtriumConfig>
    set: (config: Partial<AtriumConfig>) => Promise<AtriumConfig>
  }
  setup: {
    detect: () => Promise<DetectedTools>
  }
  worktrees: {
    list: () => Promise<WorktreeInfo[]>
    create: (repoPath: string, name: string, branch: string, isNew: boolean) => Promise<WorktreeInfo>
  }
}

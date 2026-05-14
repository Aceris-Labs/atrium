import type { PRStatus, LinkStatus, AwaitingReplyThread } from "./types";

export type AgentStatus = "working" | "needs-input" | "idle" | "no-session";

export type PRTag = "mine" | "review" | "reviewed" | "watching";

/** Per-PR review-thread enrichment, merged into the PR object on the renderer
 *  when the heavier review-threads payload arrives after the card-level fetch. */
export interface ReviewThreadInfo {
  openComments: number;
  threadsAwaitingYou: number;
  awaitingThreads: AwaitingReplyThread[];
}

export interface SessionRecap {
  text: string;
  timestamp: string;
}

/** The complete cache state. Lives in main; mirrored in the renderer's Zustand
 *  store via push events. All keys are strings so the structure is JSON-safe
 *  for IPC. */
export interface CacheState {
  /** PRs keyed by `${repo}-${number}`. */
  prs: Record<string, PRStatus>;
  /** Per-wing tag map: wingId → prKey → tags currently attached. */
  prTags: Record<string, Record<string, PRTag[]>>;
  /** Hydrated link metadata keyed by URL. */
  links: Record<string, LinkStatus>;
  /** Live agent status keyed by workspace id. */
  agentStatus: Record<string, AgentStatus>;
  /** Latest recap captured from session JSONL, keyed by workspace id. */
  recap: Record<string, SessionRecap>;
  /** Live tmux session names. */
  tmuxSessions: string[];
}

export const EMPTY_CACHE_STATE: CacheState = {
  prs: {},
  prTags: {},
  links: {},
  agentStatus: {},
  recap: {},
  tmuxSessions: [],
};

/** Push events sent from main to the renderer. The renderer applies them to
 *  its mirror store. `snapshot` resets the whole state (used on bootstrap and
 *  after wing-level invalidations). */
export type CacheEvent =
  | { type: "snapshot"; state: CacheState }
  | { type: "pr"; key: string; pr: PRStatus | null }
  | { type: "prTags"; wingId: string; key: string; tags: PRTag[] | null }
  | { type: "link"; url: string; status: LinkStatus }
  | { type: "agentStatus"; wsId: string; status: AgentStatus | null }
  | { type: "recap"; wsId: string; recap: SessionRecap | null }
  | { type: "tmuxSessions"; sessions: string[] };

export function prKey(repo: string, num: number): string {
  return `${repo}-${num}`;
}

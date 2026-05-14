import type {
  CacheEvent,
  CacheState,
  PRTag,
  SessionRecap,
  AgentStatus,
} from "../../shared/cacheTypes";
import { EMPTY_CACHE_STATE } from "../../shared/cacheTypes";
import type { PRStatus, LinkStatus } from "../../shared/types";

type Listener = (event: CacheEvent) => void;

class CacheStore {
  private state: CacheState = structuredClone(EMPTY_CACHE_STATE);
  private listeners = new Set<Listener>();
  /** Last time a wing was set active, by wingId. Drives the TTL sweep so
   *  inactive wings' cached PR tags get reclaimed after WING_TTL_MS. Not part
   *  of CacheState — purely main-side bookkeeping. */
  private wingLastActive: Record<string, number> = {};

  snapshot(): CacheState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(event: CacheEvent): void {
    for (const fn of this.listeners) fn(event);
  }

  // ── PR card-level state ────────────────────────────────────────────────────
  setPR(key: string, pr: PRStatus): void {
    const prev = this.state.prs[key];
    if (prev && shallowEqualPR(prev, pr)) return;
    this.state.prs = { ...this.state.prs, [key]: pr };
    this.emit({ type: "pr", key, pr });
  }

  deletePR(key: string): void {
    if (!(key in this.state.prs)) return;
    const { [key]: _, ...rest } = this.state.prs;
    this.state.prs = rest;
    this.emit({ type: "pr", key, pr: null });
  }

  // ── PR tag membership (per wing) ───────────────────────────────────────────
  setPRTags(wingId: string, key: string, tags: PRTag[]): void {
    const wing = this.state.prTags[wingId] ?? {};
    const prev = wing[key];
    if (prev && sameTagSet(prev, tags)) return;
    const nextWing = { ...wing, [key]: tags };
    this.state.prTags = { ...this.state.prTags, [wingId]: nextWing };
    this.emit({ type: "prTags", wingId, key, tags });
  }

  clearPRTags(wingId: string, key: string): void {
    const wing = this.state.prTags[wingId];
    if (!wing || !(key in wing)) return;
    const { [key]: _, ...rest } = wing;
    this.state.prTags = { ...this.state.prTags, [wingId]: rest };
    this.emit({ type: "prTags", wingId, key, tags: null });
  }

  /** Replaces the set of PRs carrying `tag` in a wing. PRs that previously
   *  carried the tag but are absent from `keys` have it removed; PRs in `keys`
   *  gain the tag. */
  setPRBucket(wingId: string, tag: PRTag, keys: string[]): void {
    const wantSet = new Set(keys);
    const wing = this.state.prTags[wingId] ?? {};

    for (const k of Object.keys(wing)) {
      const tags = wing[k];
      if (tags.includes(tag) && !wantSet.has(k)) {
        const next = tags.filter((t) => t !== tag);
        if (next.length === 0) this.clearPRTags(wingId, k);
        else this.setPRTags(wingId, k, next);
      }
    }
    for (const k of keys) {
      const tags = this.state.prTags[wingId]?.[k] ?? [];
      if (!tags.includes(tag)) {
        this.setPRTags(wingId, k, [...tags, tag]);
      }
    }
  }

  wingTagMap(wingId: string): Record<string, PRTag[]> {
    return this.state.prTags[wingId] ?? {};
  }

  /** Drop all tags for a wing. PR records themselves are pruned by `gcPRs`. */
  clearWingTags(wingId: string): void {
    if (!(wingId in this.state.prTags)) return;
    for (const key of Object.keys(this.state.prTags[wingId])) {
      this.emit({ type: "prTags", wingId, key, tags: null });
    }
    const { [wingId]: _, ...rest } = this.state.prTags;
    this.state.prTags = rest;
  }

  /** Remove any PR record not referenced by any wing's tag map. */
  gcPRs(): void {
    const referenced = new Set<string>();
    for (const wingId of Object.keys(this.state.prTags)) {
      for (const key of Object.keys(this.state.prTags[wingId])) {
        referenced.add(key);
      }
    }
    for (const key of Object.keys(this.state.prs)) {
      if (!referenced.has(key)) this.deletePR(key);
    }
  }

  /** Mark a wing as active right now. Used by the orchestrator on wing
   *  selection to drive the TTL sweep. */
  noteWingActive(wingId: string): void {
    this.wingLastActive[wingId] = Date.now();
  }

  /** Drop tag maps for wings inactive for longer than `ttlMs`, then GC any
   *  PR records that no surviving wing tags. Cheap to call periodically — the
   *  cache is small and tag-map walks are linear in (wings × tagged keys). */
  sweepStaleWings(ttlMs: number): void {
    const now = Date.now();
    let cleared = false;
    for (const [wingId, last] of Object.entries(this.wingLastActive)) {
      if (now - last > ttlMs) {
        this.clearWingTags(wingId);
        delete this.wingLastActive[wingId];
        cleared = true;
      }
    }
    if (cleared) this.gcPRs();
  }

  // ── Link hydration ─────────────────────────────────────────────────────────
  setLink(url: string, status: LinkStatus): void {
    const prev = this.state.links[url];
    if (
      prev &&
      prev.fetchedAt === status.fetchedAt &&
      prev.title === status.title
    ) {
      return;
    }
    this.state.links = { ...this.state.links, [url]: status };
    this.emit({ type: "link", url, status });
  }

  // ── Agent status / recap ───────────────────────────────────────────────────
  setAgentStatus(wsId: string, status: AgentStatus | null): void {
    if (status === null) {
      if (!(wsId in this.state.agentStatus)) return;
      const { [wsId]: _, ...rest } = this.state.agentStatus;
      this.state.agentStatus = rest;
      this.emit({ type: "agentStatus", wsId, status: null });
      return;
    }
    if (this.state.agentStatus[wsId] === status) return;
    this.state.agentStatus = { ...this.state.agentStatus, [wsId]: status };
    this.emit({ type: "agentStatus", wsId, status });
  }

  setRecap(wsId: string, recap: SessionRecap | null): void {
    if (recap === null) {
      if (!(wsId in this.state.recap)) return;
      const { [wsId]: _, ...rest } = this.state.recap;
      this.state.recap = rest;
      this.emit({ type: "recap", wsId, recap: null });
      return;
    }
    const prev = this.state.recap[wsId];
    if (prev && prev.timestamp === recap.timestamp && prev.text === recap.text)
      return;
    this.state.recap = { ...this.state.recap, [wsId]: recap };
    this.emit({ type: "recap", wsId, recap });
  }

  // ── Tmux sessions ──────────────────────────────────────────────────────────
  setTmuxSessions(sessions: string[]): void {
    if (sameStringList(this.state.tmuxSessions, sessions)) return;
    this.state.tmuxSessions = sessions;
    this.emit({ type: "tmuxSessions", sessions });
  }
}

function shallowEqualPR(a: PRStatus, b: PRStatus): boolean {
  return (
    a.number === b.number &&
    a.title === b.title &&
    a.state === b.state &&
    a.url === b.url &&
    a.isDraft === b.isDraft &&
    a.ciStatus === b.ciStatus &&
    a.reviewDecision === b.reviewDecision &&
    a.openComments === b.openComments &&
    a.threadsAwaitingYou === b.threadsAwaitingYou &&
    a.mergeState === b.mergeState &&
    a.autoMerge === b.autoMerge &&
    a.author === b.author &&
    a.repo === b.repo
  );
}

function sameTagSet(a: PRTag[], b: PRTag[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((t) => set.has(t));
}

function sameStringList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export const cacheStore = new CacheStore();

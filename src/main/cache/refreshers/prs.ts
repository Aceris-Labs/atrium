import { TTLRefresher } from "../refresher";
import { cacheStore } from "../store";
import { listAllPRs, listPRReviewThreads, fetchPR } from "../../github";
import { listWatchedPRs, listWorkspaces } from "../../store";
import { prKey } from "../../../shared/cacheTypes";
import type { PRStatus } from "../../../shared/types";

const PR_BUCKETS_TTL_MS = 5 * 60_000;
const WATCHED_TTL_MS = 5 * 60_000;
const WORKSPACE_LINKED_TTL_MS = 5 * 60_000;

/** Fetches authored / review-requested / reviewed PRs for a wing, plus the
 *  review-threads enrichment, and writes both to the cache. */
export class PRBucketsRefresher extends TTLRefresher {
  constructor(private wingId: string) {
    super(PR_BUCKETS_TTL_MS);
  }

  protected async tick(): Promise<void> {
    const buckets = await listAllPRs(this.wingId);

    const writeBucket = (
      tag: "mine" | "review" | "reviewed",
      list: PRStatus[],
    ) => {
      const keys: string[] = [];
      for (const pr of list) {
        if (!pr.repo) continue;
        const key = prKey(pr.repo, pr.number);
        cacheStore.setPR(key, pr);
        keys.push(key);
      }
      cacheStore.setPRBucket(this.wingId, tag, keys);
    };

    writeBucket("mine", buckets.authored);
    writeBucket("review", buckets.reviewRequested);
    writeBucket("reviewed", buckets.reviewed);

    // Review threads run in parallel with the rest of the orchestrator's work
    // — we don't await it inside the bucket call site, but here it's fine to
    // chain since the bucket write already pushed cards to the renderer.
    const threads = await listPRReviewThreads(this.wingId);
    for (const [key, info] of Object.entries(threads)) {
      const existing = cacheStore.snapshot().prs[key];
      if (!existing) continue;
      cacheStore.setPR(key, {
        ...existing,
        openComments: info.openComments,
        threadsAwaitingYou: info.threadsAwaitingYou,
        awaitingThreads: info.awaitingThreads,
      });
    }
  }
}

/** Per-wing watched-PR list. Each entry fetched individually via fetchPR so
 *  state (including merged/closed) is always current. */
export class WatchedPRsRefresher extends TTLRefresher {
  constructor(private wingId: string) {
    super(WATCHED_TTL_MS);
  }

  protected async tick(): Promise<void> {
    const watched = listWatchedPRs(this.wingId);
    const results = await Promise.all(
      watched.map(async (w) => {
        const pr = await fetchPR(w.repo, w.number);
        return pr ? { key: prKey(w.repo, w.number), pr } : null;
      }),
    );
    const keys: string[] = [];
    for (const r of results) {
      if (!r) continue;
      cacheStore.setPR(r.key, r.pr);
      keys.push(r.key);
    }
    cacheStore.setPRBucket(this.wingId, "watching", keys);
  }
}

/** Per-wing scan of every workspace.prs entry. Fetches PRs that aren't already
 *  in the cache from another bucket, and tags them "linked". The "linked" tag
 *  is what keeps these PRs alive across gcPRs even when they don't appear in
 *  any GitHub-side bucket (e.g. a closed PR no longer in `is:open` results). */
export class WorkspaceLinkedPRsRefresher extends TTLRefresher {
  constructor(private wingId: string) {
    super(WORKSPACE_LINKED_TTL_MS);
  }

  protected async tick(): Promise<void> {
    const workspaces = listWorkspaces(this.wingId);
    const refs = new Map<string, { repo: string; number: number }>();
    for (const ws of workspaces) {
      for (const p of ws.prs) {
        refs.set(prKey(p.repo, p.number), p);
      }
    }

    const snapshot = cacheStore.snapshot();
    const linkedKeys: string[] = [];
    const toFetch: { key: string; repo: string; number: number }[] = [];

    for (const [key, ref] of refs) {
      linkedKeys.push(key);
      // Always re-fetch — bucket fetches use is:pr is:open, which never
      // returns closed/merged PRs. Without an explicit per-key fetch we'd
      // never see state transitions for linked PRs.
      toFetch.push({ key, repo: ref.repo, number: ref.number });
    }

    cacheStore.setPRBucket(this.wingId, "linked", linkedKeys);

    // Fetch in parallel; ignore any that vanished (deleted PRs).
    const results = await Promise.all(
      toFetch.map(async (f) => {
        const pr = await fetchPR(f.repo, f.number);
        return pr ? { key: f.key, pr } : null;
      }),
    );
    for (const r of results) {
      if (r) cacheStore.setPR(r.key, r.pr);
    }
  }

  /** Force-refresh a single linked key. Called after a write that changes
   *  workspace.prs membership. */
  async refreshKey(repo: string, number: number): Promise<void> {
    const key = prKey(repo, number);
    const pr = await fetchPR(repo, number);
    if (pr) cacheStore.setPR(key, pr);
    // Make sure it's tagged in this wing.
    const tags = cacheStore.wingTagMap(this.wingId)[key] ?? [];
    if (!tags.includes("linked")) {
      cacheStore.setPRTags(this.wingId, key, [...tags, "linked"]);
    }
  }
}

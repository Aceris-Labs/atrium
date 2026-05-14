import { TTLRefresher } from "../refresher";
import { cacheStore } from "../store";
import {
  listAllPRs,
  listPRReviewThreads,
  fetchExplicitPRs,
} from "../../github";
import { listWatchedPRs, listWorkspaces } from "../../store";
import { prKey } from "../../../shared/cacheTypes";
import type { PRStatus } from "../../../shared/types";

const PR_BUCKETS_TTL_MS = 5 * 60_000;
const EXPLICIT_TTL_MS = 5 * 60_000;

/** Fetches authored / review-requested / reviewed PRs for a wing, plus the
 *  review-threads enrichment, and writes both to the cache. State filter is
 *  no longer applied to the searches — the cache holds the universe, the
 *  renderer slices by state via selectors. */
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

/** One batched graphql call covering explicit `(repo, number)` refs the user
 *  pointed at — both the wing's watched list and every `workspace.prs` entry.
 *  Replaces the prior N parallel `gh pr view` fan-out (one per ref, per
 *  refresher, per tick), which was the dominant source of rate-limit pressure.
 *
 *  Tagging: only the user's explicit watch list gets the `watching` tag.
 *  Workspace-attached PRs that aren't independently watched are hydrated in
 *  the cache but carry no tag from this refresher (they may still be tagged
 *  mine/review/reviewed by the bucket refresher if they match those searches).
 *  Renderer reads workspace PRs by key via `usePRsForWorkspace`, not by tag. */
export class ExplicitPRsRefresher extends TTLRefresher {
  constructor(private wingId: string) {
    super(EXPLICIT_TTL_MS);
  }

  protected async tick(): Promise<void> {
    const watched = listWatchedPRs(this.wingId);
    const workspaces = listWorkspaces(this.wingId);

    const watchedKeys = new Set(watched.map((w) => prKey(w.repo, w.number)));
    const refMap = new Map<string, { repo: string; number: number }>();
    for (const w of watched) refMap.set(prKey(w.repo, w.number), w);
    for (const ws of workspaces) {
      for (const p of ws.prs) refMap.set(prKey(p.repo, p.number), p);
    }
    const refs = [...refMap.values()];

    const fetched = await fetchExplicitPRs(refs);
    for (const [key, pr] of Object.entries(fetched)) {
      cacheStore.setPR(key, pr);
    }

    // Only the explicit watch list earns the `watching` tag. workspace.prs
    // entries are hydrated above but tag-less here.
    cacheStore.setPRBucket(this.wingId, "watching", [...watchedKeys]);
  }

  /** Force-refresh a single ref. Called after a workspace.prs / watched
   *  mutation so the new ref hydrates without waiting for the next tick. */
  async refreshKey(repo: string, number: number): Promise<void> {
    const fetched = await fetchExplicitPRs([{ repo, number }]);
    const key = prKey(repo, number);
    const pr = fetched[key];
    if (pr) cacheStore.setPR(key, pr);
  }
}

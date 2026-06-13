import { TTLRefresher } from "../refresher";
import { cacheStore } from "../store";
import { checkPRDecisions, checkPRUniverse, hydratePR } from "../../github";
import { listWatchedPRs, listWorkspaces } from "../../store";
import {
  getCachedPR,
  getCachedPRBucket,
  getCachedPRStatus,
  markPRBroadChecked,
  markPRDecisionChecked,
  notePRHydrationFailure,
  setCachedPR,
  setCachedPRBucket,
  setCachedPRSkeleton,
  shouldHydrateForBroad,
  shouldHydrateForDecision,
  sweepPRCache,
  type PRBroadCheck,
  type PRDecisionCheck,
} from "../../prCache";
import { prKey } from "../../../shared/cacheTypes";

const PR_CHECK_TTL_MS = 60_000;
const MAX_HYDRATIONS_PER_TICK = 10;
const HYDRATION_CONCURRENCY = 2;
const MISSING_RETRY_MS = 5 * 60_000;

type PRRef = { repo: string; number: number };
type HydrationReason =
  | "missing"
  | "broad-changed"
  | "decision-changed"
  | "ttl";

interface HydrationJob {
  key: string;
  repo: string;
  number: number;
  broad?: PRBroadCheck;
  decision?: PRDecisionCheck;
  reason: HydrationReason;
  priority: number;
}

interface HydrationSummary {
  selected: number;
  hydrated: number;
  failed: number;
}

function seedCachedPRs(keys: Iterable<string>): void {
  for (const key of keys) {
    const pr = getCachedPRStatus(key);
    if (pr) cacheStore.setPR(key, pr);
  }
}

/** Active-wing PR refresher. The renderer reads local cache state; this class
 *  reconciles GitHub into that cache by doing one thin discovery/check pass
 *  and then hydrating only changed/missing PRs behind a small pressure valve. */
export class PRsRefresher extends TTLRefresher {
  private seeded = false;
  private missingFailureAt = new Map<string, number>();

  constructor(private wingId: string) {
    super(PR_CHECK_TTL_MS);
  }

  private collectRefs(): {
    refs: PRRef[];
    explicitKeys: Set<string>;
    activePrimaryKeys: Set<string>;
    watchedKeys: Set<string>;
  } {
    const watched = listWatchedPRs(this.wingId);
    const workspaces = listWorkspaces(this.wingId);

    const watchedKeys = new Set(watched.map((w) => prKey(w.repo, w.number)));
    const activePrimaryKeys = new Set<string>();
    const refMap = new Map<string, PRRef>();
    for (const w of watched) refMap.set(prKey(w.repo, w.number), w);
    for (const ws of workspaces) {
      for (let i = 0; i < ws.prs.length; i++) {
        const p = ws.prs[i];
        const key = prKey(p.repo, p.number);
        refMap.set(key, p);
        if (i === 0 && ws.status === "active") activePrimaryKeys.add(key);
      }
    }
    return {
      refs: [...refMap.values()],
      explicitKeys: new Set(refMap.keys()),
      activePrimaryKeys,
      watchedKeys,
    };
  }

  private seedCachedState(): void {
    if (this.seeded) return;
    this.seeded = true;

    const { refs, watchedKeys } = this.collectRefs();
    const mine = getCachedPRBucket(this.wingId, "mine");
    const review = getCachedPRBucket(this.wingId, "review");
    const watching = [...watchedKeys];
    const explicitKeys = refs.map((r) => prKey(r.repo, r.number));

    seedCachedPRs([...mine, ...review, ...watching, ...explicitKeys]);
    cacheStore.setPRBucket(this.wingId, "mine", mine);
    cacheStore.setPRBucket(this.wingId, "review", review);
    cacheStore.setPRBucket(this.wingId, "reviewed", []);
    cacheStore.setPRBucket(this.wingId, "watching", watching);
  }

  protected async tick(): Promise<void> {
    const startedAt = Date.now();
    this.seedCachedState();

    const { refs, explicitKeys, activePrimaryKeys, watchedKeys } =
      this.collectRefs();
    seedCachedPRs(refs.map((r) => prKey(r.repo, r.number)));

    console.log(
      `[prs] refresh start wing=${this.wingId} explicit=${refs.length} watched=${watchedKeys.size}`,
    );
    const universe = await checkPRUniverse(this.wingId, refs);
    if (!universe) {
      console.log(
        `[prs] refresh aborted wing=${this.wingId} reason=universe-check-failed elapsed=${Date.now() - startedAt}ms`,
      );
      return;
    }

    this.writeDiscoveredSkeletons(Object.values(universe.checks));
    setCachedPRBucket(this.wingId, "mine", universe.buckets.mine);
    setCachedPRBucket(this.wingId, "review", universe.buckets.review);
    setCachedPRBucket(this.wingId, "reviewed", []);
    setCachedPRBucket(this.wingId, "watching", [...watchedKeys]);

    cacheStore.setPRBucket(this.wingId, "mine", universe.buckets.mine);
    cacheStore.setPRBucket(this.wingId, "review", universe.buckets.review);
    cacheStore.setPRBucket(this.wingId, "reviewed", []);
    cacheStore.setPRBucket(this.wingId, "watching", [...watchedKeys]);

    console.log(
      `[prs] discovery wing=${this.wingId} checks=${Object.keys(universe.checks).length} mine=${universe.buckets.mine.length} review=${universe.buckets.review.length}`,
    );

    const decisionRefs = this.hotDecisionRefs(
      refs,
      universe.checks,
      universe.buckets.mine,
      universe.buckets.review,
      watchedKeys,
      activePrimaryKeys,
    );
    const decisionChecks = await checkPRDecisions(decisionRefs);
    console.log(
      `[prs] decisions wing=${this.wingId} hot=${decisionRefs.length} checks=${decisionChecks ? Object.keys(decisionChecks).length : 0}`,
    );

    const jobs = this.buildHydrationJobs(
      Object.values(universe.checks),
      decisionChecks ? Object.values(decisionChecks) : [],
      explicitKeys,
    );
    const summary = await this.runHydrationJobs(jobs);
    sweepPRCache();
    console.log(
      `[prs] refresh done wing=${this.wingId} jobs=${jobs.length} selected=${summary.selected} hydrated=${summary.hydrated} failed=${summary.failed} elapsed=${Date.now() - startedAt}ms`,
    );
  }

  private writeDiscoveredSkeletons(checks: PRBroadCheck[]): void {
    for (const check of checks) {
      const pr = setCachedPRSkeleton(check);
      if (pr) cacheStore.setPR(check.key, pr);
    }
  }

  private buildHydrationJobs(
    broadChecks: PRBroadCheck[],
    decisionChecks: PRDecisionCheck[],
    explicitKeys: Set<string>,
  ): HydrationJob[] {
    const jobs = new Map<string, HydrationJob>();
    const now = Date.now();

    for (const check of broadChecks) {
      const cachedRecord = getCachedPR(check.key);
      if (cachedRecord?.pr) cacheStore.setPR(check.key, cachedRecord.pr);

      if (
        !cachedRecord?.pr &&
        this.missingFailureAt.has(check.key) &&
        now - (this.missingFailureAt.get(check.key) ?? 0) < MISSING_RETRY_MS
      ) {
        continue;
      }

      if (!shouldHydrateForBroad(check, now)) {
        if (cachedRecord?.broadSignature === check.broadSignature)
          markPRBroadChecked(check);
        continue;
      }

      const reason: HydrationReason =
        !cachedRecord?.pr || !cachedRecord.hydratedAt
          ? "missing"
          : cachedRecord.broadSignature !== check.broadSignature
            ? "broad-changed"
            : "ttl";
      jobs.set(check.key, {
        key: check.key,
        repo: check.repo,
        number: check.number,
        broad: check,
        reason,
        priority: this.priorityFor(check.key, reason, explicitKeys),
      });
    }

    for (const check of decisionChecks) {
      const cachedRecord = getCachedPR(check.key);
      if (
        !cachedRecord?.pr &&
        this.missingFailureAt.has(check.key) &&
        now - (this.missingFailureAt.get(check.key) ?? 0) < MISSING_RETRY_MS
      ) {
        continue;
      }

      if (!shouldHydrateForDecision(check, now)) {
        if (cachedRecord?.decisionSignature === check.decisionSignature)
          markPRDecisionChecked(check);
        continue;
      }

      const existing = jobs.get(check.key);
      if (existing) {
        existing.decision = check;
        continue;
      }
      jobs.set(check.key, {
        key: check.key,
        repo: check.repo,
        number: check.number,
        decision: check,
        reason: cachedRecord?.pr ? "decision-changed" : "missing",
        priority: this.priorityFor(
          check.key,
          cachedRecord?.pr ? "decision-changed" : "missing",
          explicitKeys,
        ),
      });
    }

    return [...jobs.values()].sort((a, b) => a.priority - b.priority);
  }

  private hotDecisionRefs(
    refs: PRRef[],
    broadChecks: Record<string, PRBroadCheck>,
    mineKeys: string[],
    reviewKeys: string[],
    watchedKeys: Set<string>,
    activePrimaryKeys: Set<string>,
  ): PRRef[] {
    const hotKeys = new Set<string>([
      ...mineKeys,
      ...reviewKeys,
      ...watchedKeys,
      ...activePrimaryKeys,
    ]);
    for (const [key, check] of Object.entries(broadChecks)) {
      if (check.state === "open") hotKeys.add(key);
    }
    for (const ref of refs) {
      const key = prKey(ref.repo, ref.number);
      const cached = getCachedPRStatus(key);
      if (cached?.state === "open") hotKeys.add(key);
    }

    const refMap = new Map(
      refs.map((ref) => [prKey(ref.repo, ref.number), ref]),
    );
    for (const check of Object.values(broadChecks)) {
      refMap.set(check.key, { repo: check.repo, number: check.number });
    }

    const isOpen = (key: string): boolean => {
      const broad = broadChecks[key];
      if (broad) return broad.state === "open";
      return getCachedPRStatus(key)?.state === "open";
    };

    return [...hotKeys]
      .filter(isOpen)
      .map((key) => refMap.get(key))
      .filter((ref): ref is PRRef => Boolean(ref));
  }

  private priorityFor(
    key: string,
    reason: HydrationReason,
    explicitKeys: Set<string>,
  ): number {
    const explicit = explicitKeys.has(key);
    if (explicit && reason === "missing") return 0;
    if (!explicit && reason === "missing") return 1;
    if (explicit && reason === "decision-changed") return 2;
    if (!explicit && reason === "decision-changed") return 3;
    if (explicit && reason === "broad-changed") return 4;
    if (!explicit && reason === "broad-changed") return 5;
    if (explicit) return 8;
    return 9;
  }

  private async runHydrationJobs(
    jobs: HydrationJob[],
  ): Promise<HydrationSummary> {
    const selected = jobs.slice(0, MAX_HYDRATIONS_PER_TICK);
    let next = 0;
    let hydratedCount = 0;
    let failedCount = 0;

    if (jobs.length > 0) {
      const reasons = jobs.reduce<Record<HydrationReason, number>>(
        (acc, job) => {
          acc[job.reason] += 1;
          return acc;
        },
        { missing: 0, "broad-changed": 0, "decision-changed": 0, ttl: 0 },
      );
      console.log(
        `[prs] hydration queue total=${jobs.length} selected=${selected.length} missing=${reasons.missing} broadChanged=${reasons["broad-changed"]} decisionChanged=${reasons["decision-changed"]} ttl=${reasons.ttl}`,
      );
    } else {
      console.log("[prs] hydration queue total=0 selected=0");
    }

    const worker = async () => {
      while (next < selected.length) {
        const job = selected[next++];
        const hydrated = await hydratePR(job.repo, job.number);
        if (!hydrated) {
          failedCount++;
          console.log(
            `[prs] hydrate failed key=${job.key} reason=${job.reason}`,
          );
          if (job.reason === "missing") {
            this.missingFailureAt.set(job.key, Date.now());
          } else {
            notePRHydrationFailure(job.broad ?? job.decision!);
          }
          continue;
        }

        hydratedCount++;
        this.missingFailureAt.delete(job.key);
        setCachedPR(job.key, hydrated.pr, {
          broad: hydrated.broad,
          decision: hydrated.decision,
        });
        cacheStore.setPR(job.key, hydrated.pr);
      }
    };

    const count = Math.min(HYDRATION_CONCURRENCY, selected.length);
    await Promise.all(Array.from({ length: count }, () => worker()));
    return {
      selected: selected.length,
      hydrated: hydratedCount,
      failed: failedCount,
    };
  }

  /** Force-refresh a single ref after a workspace.prs / watched mutation so
   *  the new ref hydrates immediately without waiting for the next check. */
  async refreshKey(repo: string, number: number): Promise<void> {
    const startedAt = Date.now();
    const key = prKey(repo, number);
    console.log(`[prs] refresh-one start key=${key}`);
    const cached = getCachedPRStatus(key);
    if (cached) cacheStore.setPR(key, cached);

    const hydrated = await hydratePR(repo, number);
    if (!hydrated) {
      this.missingFailureAt.set(key, Date.now());
      console.log(
        `[prs] refresh-one failed key=${key} elapsed=${Date.now() - startedAt}ms`,
      );
      return;
    }
    this.missingFailureAt.delete(key);
    setCachedPR(key, hydrated.pr, {
      broad: hydrated.broad,
      decision: hydrated.decision,
    });
    cacheStore.setPR(key, hydrated.pr);
    console.log(
      `[prs] refresh-one done key=${key} elapsed=${Date.now() - startedAt}ms`,
    );
  }
}

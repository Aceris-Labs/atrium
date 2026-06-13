import { existsSync, readFileSync } from "fs";
import { mkdir, rename, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { ATRIUM_DIR } from "./store";
import type { PRTag } from "../shared/cacheTypes";
import type { PRStatus } from "../shared/types";

const CACHE_FILE = join(ATRIUM_DIR, "pr-cache.json");
const CACHE_VERSION = 1;

/** Rehydrate even unchanged PRs occasionally so fields not represented in the
 *  cheap signatures cannot stay stale forever. */
const HYDRATION_TTL_MS = 6 * 60 * 60_000;
const HYDRATION_RETRY_MS = 5 * 60_000;
const CACHE_RETENTION_MS = 45 * 24 * 60 * 60_000;

export interface PRCheck {
  key: string;
  repo: string;
  number: number;
  githubId?: string;
  updatedAt?: string;
}

export interface PRBroadCheck extends PRCheck {
  broadSignature: string;
  state?: PRStatus["state"];
  pr?: PRStatus;
}

export interface PRDecisionCheck extends PRCheck {
  decisionSignature: string;
}

export interface CachedPRRecord {
  pr: PRStatus;
  /** Legacy v1 signature; migrated to broadSignature on load. */
  signature?: string;
  broadSignature?: string;
  decisionSignature?: string;
  githubId?: string;
  /** Legacy v1 checkedAt; migrated to broadCheckedAt on load. */
  checkedAt?: string;
  broadCheckedAt?: string;
  decisionCheckedAt?: string;
  hydratedAt?: string;
  lastSeenAt?: string;
  lastHydrationFailedAt?: string;
}

type CachedWingBuckets = Partial<Record<PRTag, string[]>> & {
  updatedAt?: string;
};

interface PersistedPRCache {
  version: number;
  prs: Record<string, CachedPRRecord>;
  wingBuckets: Record<string, CachedWingBuckets>;
}

function emptyCache(): PersistedPRCache {
  return { version: CACHE_VERSION, prs: {}, wingBuckets: {} };
}

let cache: PersistedPRCache = load();

function load(): PersistedPRCache {
  if (!existsSync(CACHE_FILE)) return emptyCache();
  try {
    const raw = JSON.parse(readFileSync(CACHE_FILE, "utf-8")) as Partial<
      PersistedPRCache
    >;
    const prs: Record<string, CachedPRRecord> = {};
    for (const [key, record] of Object.entries(raw.prs ?? {})) {
      prs[key] = {
        ...record,
        broadSignature: record.broadSignature ?? record.signature,
        broadCheckedAt: record.broadCheckedAt ?? record.checkedAt,
      };
    }
    return {
      version: CACHE_VERSION,
      prs,
      wingBuckets: raw.wingBuckets ?? {},
    };
  } catch {
    return emptyCache();
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persist().catch(() => {});
  }, 200);
}

async function persist(): Promise<void> {
  await mkdir(ATRIUM_DIR, { recursive: true });
  const tmp = `${CACHE_FILE}.tmp.${process.pid}.${Date.now()}`;
  try {
    await writeFile(tmp, JSON.stringify(cache, null, 2));
    await rename(tmp, CACHE_FILE);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseTime(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getCachedPR(key: string): CachedPRRecord | undefined {
  return cache.prs[key];
}

export function getCachedPRStatus(key: string): PRStatus | undefined {
  return cache.prs[key]?.pr;
}

export function setCachedPR(
  key: string,
  pr: PRStatus,
  checks?: { broad?: PRBroadCheck; decision?: PRDecisionCheck },
): void {
  const at = nowIso();
  const prev = cache.prs[key];
  cache.prs[key] = {
    ...prev,
    pr,
    broadSignature: checks?.broad?.broadSignature ?? prev?.broadSignature,
    decisionSignature:
      checks?.decision?.decisionSignature ?? prev?.decisionSignature,
    githubId:
      checks?.broad?.githubId ?? checks?.decision?.githubId ?? prev?.githubId,
    broadCheckedAt: checks?.broad ? at : prev?.broadCheckedAt,
    decisionCheckedAt: checks?.decision ? at : prev?.decisionCheckedAt,
    hydratedAt: at,
    lastSeenAt: at,
    lastHydrationFailedAt: undefined,
  };
  schedulePersist();
}

export function setCachedPRSkeleton(check: PRBroadCheck): PRStatus | undefined {
  if (!check.pr) return cache.prs[check.key]?.pr;
  const at = nowIso();
  const prev = cache.prs[check.key];
  const pr = prev?.pr
    ? {
        ...prev.pr,
        number: check.pr.number,
        title: check.pr.title,
        state: check.pr.state,
        url: check.pr.url,
        isDraft: check.pr.isDraft,
        author: check.pr.author,
        repo: check.pr.repo,
      }
    : check.pr;
  cache.prs[check.key] = {
    ...prev,
    pr,
    broadSignature: check.broadSignature,
    githubId: check.githubId ?? prev?.githubId,
    broadCheckedAt: at,
    lastSeenAt: at,
  };
  schedulePersist();
  return pr;
}

export function markPRBroadChecked(check: PRBroadCheck): void {
  const prev = cache.prs[check.key];
  if (!prev) return;
  const at = nowIso();
  cache.prs[check.key] = {
    ...prev,
    broadSignature: check.broadSignature,
    githubId: check.githubId ?? prev.githubId,
    broadCheckedAt: at,
    lastSeenAt: at,
  };
  schedulePersist();
}

export function markPRDecisionChecked(check: PRDecisionCheck): void {
  const prev = cache.prs[check.key];
  if (!prev) return;
  const at = nowIso();
  cache.prs[check.key] = {
    ...prev,
    decisionSignature: check.decisionSignature,
    githubId: check.githubId ?? prev.githubId,
    decisionCheckedAt: at,
    lastSeenAt: at,
  };
  schedulePersist();
}

export function notePRHydrationFailure(check: PRCheck): void {
  const prev = cache.prs[check.key];
  if (!prev) return;
  const at = nowIso();
  cache.prs[check.key] = {
    ...prev,
    checkedAt: at,
    lastSeenAt: at,
    lastHydrationFailedAt: at,
  };
  schedulePersist();
}

function canRetryHydration(record: CachedPRRecord, now: number): boolean {
  const failedAt = parseTime(record.lastHydrationFailedAt);
  return failedAt === null || now - failedAt >= HYDRATION_RETRY_MS;
}

export function shouldHydrateForBroad(
  check: PRBroadCheck,
  now = Date.now(),
): boolean {
  const record = cache.prs[check.key];
  if (!record?.pr) return true;
  if (!canRetryHydration(record, now)) return false;

  if (record.broadSignature !== check.broadSignature) return true;

  const hydratedAt = parseTime(record.hydratedAt);
  return hydratedAt === null || now - hydratedAt > HYDRATION_TTL_MS;
}

export function shouldHydrateForDecision(
  check: PRDecisionCheck,
  now = Date.now(),
): boolean {
  const record = cache.prs[check.key];
  if (!record?.pr) return true;
  if (!canRetryHydration(record, now)) return false;

  return record.decisionSignature !== check.decisionSignature;
}

export function getCachedPRBucket(
  wingId: string,
  tag: PRTag,
): string[] {
  return cache.wingBuckets[wingId]?.[tag] ?? [];
}

export function setCachedPRBucket(
  wingId: string,
  tag: PRTag,
  keys: string[],
): void {
  const prev = cache.wingBuckets[wingId] ?? {};
  cache.wingBuckets[wingId] = {
    ...prev,
    [tag]: keys,
    updatedAt: nowIso(),
  };
  schedulePersist();
}

export function sweepPRCache(retentionMs = CACHE_RETENTION_MS): void {
  const now = Date.now();
  const referenced = new Set<string>();
  for (const buckets of Object.values(cache.wingBuckets)) {
    for (const tag of ["mine", "review", "reviewed", "watching"] as PRTag[]) {
      for (const key of buckets[tag] ?? []) referenced.add(key);
    }
  }

  let dirty = false;
  for (const [key, record] of Object.entries(cache.prs)) {
    if (referenced.has(key)) continue;
    const lastSeen =
      parseTime(record.lastSeenAt) ??
      parseTime(record.hydratedAt) ??
      parseTime(record.broadCheckedAt) ??
      parseTime(record.decisionCheckedAt) ??
      parseTime(record.checkedAt);
    if (lastSeen !== null && now - lastSeen > retentionMs) {
      delete cache.prs[key];
      dirty = true;
    }
  }

  for (const [wingId, buckets] of Object.entries(cache.wingBuckets)) {
    const updatedAt = parseTime(buckets.updatedAt);
    if (updatedAt !== null && now - updatedAt > retentionMs) {
      delete cache.wingBuckets[wingId];
      dirty = true;
    }
  }

  if (dirty) schedulePersist();
}

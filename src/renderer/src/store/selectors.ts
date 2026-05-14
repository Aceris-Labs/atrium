import { useMemo } from "react";
import { useCacheStore } from "./cache";
import { prKey } from "../../../shared/cacheTypes";
import type {
  PRTag,
  AgentStatus,
  SessionRecap,
} from "../../../shared/cacheTypes";
import type { PRStatus, LinkStatus, Workspace } from "../../../shared/types";

/** Semantic selectors over the PR universe. The cache holds PRs across all
 *  states; views compose these slices instead of touching cache shape or
 *  tag membership directly. New views = new selector, not a new refresher. */
function filterByTag(
  prs: Record<string, PRStatus>,
  wingTags: Record<string, PRTag[]> | undefined,
  tag: PRTag,
): PRStatus[] {
  if (!wingTags) return [];
  const out: PRStatus[] = [];
  for (const key of Object.keys(wingTags)) {
    if (wingTags[key].includes(tag)) {
      const pr = prs[key];
      if (pr) out.push(pr);
    }
  }
  return out;
}

export function usePR(
  repo: string | undefined,
  num: number,
): PRStatus | undefined {
  return useCacheStore((s) => (repo ? s.prs[prKey(repo, num)] : undefined));
}

export function usePRByKey(key: string): PRStatus | undefined {
  return useCacheStore((s) => s.prs[key]);
}

/** All PRs in a wing carrying the given tag. Lower-level — prefer the
 *  semantic hooks below (`useAuthoredOpen`, etc.) which compose this. */
export function usePRsByTag(wingId: string | null, tag: PRTag): PRStatus[] {
  const prs = useCacheStore((s) => s.prs);
  const wingTags = useCacheStore((s) =>
    wingId ? s.prTags[wingId] : undefined,
  );
  return useMemo(
    () => (wingId ? filterByTag(prs, wingTags, tag) : []),
    [wingId, wingTags, prs, tag],
  );
}

/** Open PRs authored by me in this wing. */
export function useAuthoredOpen(wingId: string | null): PRStatus[] {
  const all = usePRsByTag(wingId, "mine");
  return useMemo(() => all.filter((pr) => pr.state === "open"), [all]);
}

/** Merged PRs authored by me in this wing — for "recently shipped" views. */
export function useAuthoredMerged(wingId: string | null): PRStatus[] {
  const all = usePRsByTag(wingId, "mine");
  return useMemo(() => all.filter((pr) => pr.state === "merged"), [all]);
}

/** Open PRs requested-of-me or @mentioning me. */
export function useReviewRequestedOpen(wingId: string | null): PRStatus[] {
  const all = usePRsByTag(wingId, "review");
  return useMemo(() => all.filter((pr) => pr.state === "open"), [all]);
}

/** Open PRs I've reviewed (but didn't author). Drives the inbox alongside
 *  authored/review buckets so threads where I've already chimed in still
 *  show awaiting-replies. */
export function useReviewedOpen(wingId: string | null): PRStatus[] {
  const all = usePRsByTag(wingId, "reviewed");
  return useMemo(() => all.filter((pr) => pr.state === "open"), [all]);
}

/** PRs the user has explicitly watched in this wing (any state). */
export function useWatched(wingId: string | null): PRStatus[] {
  return usePRsByTag(wingId, "watching");
}

/** Tags attached to a PR in a given wing. */
export function usePRTags(
  wingId: string | null,
  repo: string | undefined,
  num: number,
): PRTag[] {
  return useCacheStore((s) => {
    if (!wingId || !repo) return EMPTY_TAGS;
    return s.prTags[wingId]?.[prKey(repo, num)] ?? EMPTY_TAGS;
  });
}

const EMPTY_TAGS: PRTag[] = [];

/** PRs linked to a specific workspace, in workspace.prs order. Returns
 *  undefined entries for keys not yet hydrated — callers render skeletons. */
export function usePRsForWorkspace(
  workspace: Pick<Workspace, "prs">,
): Array<{ ref: { repo: string; number: number }; pr: PRStatus | undefined }> {
  const prs = useCacheStore((s) => s.prs);
  return useMemo(
    () =>
      workspace.prs.map((ref) => ({
        ref,
        pr: prs[prKey(ref.repo, ref.number)],
      })),
    [workspace.prs, prs],
  );
}

export function useLinkHydration(url: string): LinkStatus | undefined {
  return useCacheStore((s) => s.links[url]);
}

export function useAgentStatus(wsId: string): AgentStatus {
  return useCacheStore((s) => s.agentStatus[wsId] ?? "no-session");
}

export function useRecap(wsId: string): SessionRecap | undefined {
  return useCacheStore((s) => s.recap[wsId]);
}

export function useTmuxSessions(): string[] {
  return useCacheStore((s) => s.tmuxSessions);
}

export function useTmuxSession(name: string | undefined): boolean {
  return useCacheStore((s) => (name ? s.tmuxSessions.includes(name) : false));
}

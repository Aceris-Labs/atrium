import { execFile, exec } from "child_process";
import { promisify } from "util";
import { readdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getConfig, getWingProjectDir } from "./store";
import type { PRStatus, RepoInfo, AwaitingReplyThread } from "../shared/types";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

const PR_FIELDS_LITE = `
  ... on PullRequest {
    number
    title
    url
    isDraft
    reviewDecision
    mergeStateStatus
    autoMergeRequest { enabledAt }
    repository { nameWithOwner }
    author { login }
    commits(last: 1) {
      nodes { commit { statusCheckRollup { state } } }
    }
  }
`;

const PR_FIELDS_THREADS = `
  ... on PullRequest {
    number
    repository { nameWithOwner }
    title
    url
    reviewThreads(first: 10) {
      totalCount
      nodes {
        id
        isResolved
        path
        line
        comments(last: 1) {
          nodes {
            author { login }
            body
            createdAt
            url
          }
        }
      }
    }
  }
`;

export interface AllPRs {
  authored: PRStatus[];
  reviewRequested: PRStatus[];
  reviewed: PRStatus[];
}

/** Per-PR review-thread enrichment, keyed by `${repo}-${number}`. Fetched in
 *  a separate GraphQL roundtrip so card-level data can render without waiting
 *  on the heavier review-threads payload. */
export type ReviewThreadInfo = {
  openComments: number;
  threadsAwaitingYou: number;
  awaitingThreads: AwaitingReplyThread[];
};

/** Fetches authored / review-requested / reviewed PRs (card-level fields only,
 *  no review threads). Pair with `listPRReviewThreads` for the inbox/badges. */
export async function listAllPRs(wingId: string): Promise<AllPRs> {
  const empty: AllPRs = { authored: [], reviewRequested: [], reviewed: [] };
  const scope = await wingRepoScope(wingId);
  if (scope === null) return empty;

  const authoredQ = `is:pr is:open author:@me${scope}`;
  const reviewRequestedQ = `is:pr is:open review-requested:@me${scope}`;
  const reviewedQ = `is:pr is:open reviewed-by:@me -author:@me${scope}`;

  const query = `
    query {
      authored: search(query: "${authoredQ}", type: ISSUE, first: 30) {
        edges { node { ${PR_FIELDS_LITE} } }
      }
      reviewRequested: search(query: "${reviewRequestedQ}", type: ISSUE, first: 30) {
        edges { node { ${PR_FIELDS_LITE} } }
      }
      reviewed: search(query: "${reviewedQ}", type: ISSUE, first: 30) {
        edges { node { ${PR_FIELDS_LITE} } }
      }
    }
  `;

  const { ghPath } = getConfig();
  try {
    const { stdout } = await execFileAsync(ghPath, [
      "api",
      "graphql",
      "-f",
      `query=${query}`,
    ]);
    const data = JSON.parse(stdout);
    if (data.errors) {
      console.error("[github] GraphQL errors:", data.errors);
    }
    const extract = (key: string): PRStatus[] =>
      (data.data?.[key]?.edges ?? [])
        .map((e: any) => e.node)
        .filter((n: any) => n?.number != null)
        .map((n: any) => mapNodeLite(n));
    return {
      authored: extract("authored"),
      reviewRequested: extract("reviewRequested"),
      reviewed: extract("reviewed"),
    };
  } catch (err) {
    console.error("[github] listAllPRs failed:", err);
    return empty;
  }
}

/** Returns review-thread enrichment for the same PRs `listAllPRs` returns. */
export async function listPRReviewThreads(
  wingId: string,
): Promise<Record<string, ReviewThreadInfo>> {
  const scope = await wingRepoScope(wingId);
  if (scope === null) return {};

  const authoredQ = `is:pr is:open author:@me${scope}`;
  const reviewRequestedQ = `is:pr is:open review-requested:@me${scope}`;
  const reviewedQ = `is:pr is:open reviewed-by:@me -author:@me${scope}`;

  const query = `
    query {
      viewer { login }
      authored: search(query: "${authoredQ}", type: ISSUE, first: 30) {
        edges { node { ${PR_FIELDS_THREADS} } }
      }
      reviewRequested: search(query: "${reviewRequestedQ}", type: ISSUE, first: 30) {
        edges { node { ${PR_FIELDS_THREADS} } }
      }
      reviewed: search(query: "${reviewedQ}", type: ISSUE, first: 30) {
        edges { node { ${PR_FIELDS_THREADS} } }
      }
    }
  `;

  const { ghPath } = getConfig();
  try {
    const { stdout } = await execFileAsync(ghPath, [
      "api",
      "graphql",
      "-f",
      `query=${query}`,
    ]);
    const data = JSON.parse(stdout);
    if (data.errors) {
      console.error("[github] GraphQL errors:", data.errors);
    }
    const viewerLogin: string | null = data.data?.viewer?.login ?? null;
    const out: Record<string, ReviewThreadInfo> = {};
    for (const key of ["authored", "reviewRequested", "reviewed"]) {
      for (const edge of data.data?.[key]?.edges ?? []) {
        const node = edge.node;
        if (!node || node.number == null) continue;
        const repo = node.repository?.nameWithOwner ?? "";
        out[`${repo}-${node.number}`] = mapReviewThreads(node, viewerLogin);
      }
    }
    return out;
  } catch (err) {
    console.error("[github] listPRReviewThreads failed:", err);
    return {};
  }
}

/** Returns the search-query suffix scoping to the wing's repos.
 *  - "" (empty string) → no rootDir; query runs unbounded across GitHub.
 *  - null → rootDir set but no repos found; caller should return empty.
 *  - " repo:a/b repo:c/d" → scope to specific repos. */
async function wingRepoScope(wingId: string): Promise<string | null> {
  const rootDir = getWingProjectDir(wingId);
  if (!rootDir) return "";
  const repos = await getReposInDirectory(rootDir);
  if (repos.length === 0) return null;
  return " " + repos.map((r) => `repo:${r.repo}`).join(" ");
}

export async function getReposInDirectory(dir: string): Promise<RepoInfo[]> {
  const expanded = dir.replace(/^~/, homedir());
  if (!existsSync(expanded)) return [];

  // Case 1: the directory itself is a git repo.
  if (existsSync(join(expanded, ".git"))) {
    const repo = await readRepoRemote(expanded);
    return repo ? [{ path: expanded, repo }] : [];
  }

  // Case 2: the directory is a container — scan immediate children in parallel.
  let entries: ReturnType<typeof readdirSync> = [];
  try {
    entries = readdirSync(expanded, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates = entries
    .filter(
      (e) => e.isDirectory() && existsSync(join(expanded, e.name, ".git")),
    )
    .map((e) => join(expanded, e.name));

  const results = await Promise.all(
    candidates.map(async (fullPath) => {
      const repo = await readRepoRemote(fullPath);
      return repo ? ({ path: fullPath, repo } as RepoInfo) : null;
    }),
  );
  return results.filter((r): r is RepoInfo => r !== null);
}

async function readRepoRemote(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["remote", "get-url", "origin"],
      { cwd: repoPath },
    );
    return parseGitRemote(stdout.trim());
  } catch {
    return null;
  }
}

function parseGitRemote(url: string): string | null {
  const match = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  return match ? match[1] : null;
}

export async function getDefaultRepo(wingId: string): Promise<string | null> {
  const rootDir = getWingProjectDir(wingId);
  if (!rootDir) return null;
  const repos = await getReposInDirectory(rootDir);
  return repos.length > 0 ? repos[0].repo : null;
}

export async function fetchPR(
  repo: string,
  number: number,
): Promise<PRStatus | null> {
  const { ghPath } = getConfig();
  try {
    const { stdout } = await execFileAsync(ghPath, [
      "pr",
      "view",
      String(number),
      "--repo",
      repo,
      "--json",
      "number,title,url,isDraft,reviewDecision,statusCheckRollup,state,reviewRequests",
    ]);
    const pr = JSON.parse(stdout);
    const checks = Array.isArray(pr.statusCheckRollup)
      ? pr.statusCheckRollup
      : [];
    return {
      number: pr.number,
      title: pr.title,
      state: pr.state?.toLowerCase() ?? "open",
      url: pr.url,
      isDraft: pr.isDraft ?? false,
      ciStatus: deriveCIFromChecks(checks),
      reviewDecision: pr.reviewDecision ?? null,
      openComments: 0,
      repo,
    };
  } catch {
    return null;
  }
}

export async function listTmuxSessions(): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      'tmux list-sessions -F "#{session_name}" 2>/dev/null',
    );
    return stdout.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function mapNodeLite(node: any): PRStatus {
  const ciState =
    node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null;
  const repo = node.repository?.nameWithOwner ?? "";
  return {
    number: node.number,
    title: node.title,
    state: "open",
    url: node.url,
    isDraft: node.isDraft ?? false,
    ciStatus: mapCIState(ciState),
    reviewDecision: node.reviewDecision ?? null,
    openComments: 0,
    mergeState: node.mergeStateStatus ?? undefined,
    autoMerge: !!node.autoMergeRequest,
    author: node.author?.login,
    repo,
  };
}

function mapReviewThreads(
  node: any,
  viewerLogin: string | null,
): ReviewThreadInfo {
  const threads = node.reviewThreads?.nodes ?? [];
  const unresolvedThreads = threads.filter((t: any) => !t.isResolved);
  const repo = node.repository?.nameWithOwner ?? "";
  const awaitingThreads: AwaitingReplyThread[] = viewerLogin
    ? unresolvedThreads
        .map((t: any): AwaitingReplyThread | null => {
          const last = t.comments?.nodes?.[0];
          const lastAuthor = last?.author?.login;
          if (!lastAuthor || lastAuthor === viewerLogin) return null;
          return {
            threadId: t.id,
            pr: {
              number: node.number,
              title: node.title,
              url: node.url,
              repo,
            },
            path: t.path ?? undefined,
            line: t.line ?? null,
            url: last.url ?? node.url,
            lastComment: {
              author: lastAuthor,
              body: last.body ?? "",
              createdAt: last.createdAt ?? "",
            },
          };
        })
        .filter((t: AwaitingReplyThread | null): t is AwaitingReplyThread =>
          Boolean(t),
        )
    : [];

  return {
    openComments: unresolvedThreads.length,
    threadsAwaitingYou: awaitingThreads.length,
    awaitingThreads,
  };
}

function deriveCIFromChecks(checks: any[]): PRStatus["ciStatus"] {
  if (checks.length === 0) return "unknown";
  const hasFailure = checks.some(
    (c) =>
      c.conclusion === "FAILURE" ||
      c.conclusion === "ERROR" ||
      c.state === "FAILURE" ||
      c.state === "ERROR",
  );
  if (hasFailure) return "failure";
  const hasRunning = checks.some(
    (c) =>
      c.status === "IN_PROGRESS" ||
      c.status === "QUEUED" ||
      c.status === "PENDING" ||
      c.state === "PENDING",
  );
  if (hasRunning) return "pending";
  const allDone = checks.every(
    (c) =>
      c.conclusion === "SUCCESS" ||
      c.conclusion === "SKIPPED" ||
      c.conclusion === "NEUTRAL" ||
      c.state === "SUCCESS",
  );
  if (allDone) return "success";
  return "unknown";
}

function mapCIState(state: string | null): PRStatus["ciStatus"] {
  if (!state) return "unknown";
  if (state === "SUCCESS") return "success";
  if (state === "FAILURE" || state === "ERROR") return "failure";
  if (state === "PENDING" || state === "EXPECTED") return "pending";
  return "unknown";
}

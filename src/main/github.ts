import { execFile, exec } from "child_process";
import { promisify } from "util";
import { readdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getConfig, getWingProjectDir } from "./store";
import type { PRBroadCheck, PRDecisionCheck } from "./prCache";
import { prKey } from "../shared/cacheTypes";
import type { PRStatus, RepoInfo } from "../shared/types";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

const PR_FIELDS_BROAD_CHECK = `
  ... on PullRequest {
    id
    number
    title
    url
    updatedAt
    state
    isDraft
    headRefOid
    repository { nameWithOwner }
    author { login }
  }
`;

const PR_FIELDS_DECISION_CHECK = `
  ... on PullRequest {
    id
    number
    reviewDecision
    mergeStateStatus
    autoMergeRequest { enabledAt }
    repository { nameWithOwner }
    commits(last: 1) {
      nodes { commit { oid statusCheckRollup { state } } }
    }
  }
`;

const PR_FIELDS_DETAIL = `
  ... on PullRequest {
    id
    number
    title
    url
    updatedAt
    state
    isDraft
    headRefOid
    reviewDecision
    mergeStateStatus
    autoMergeRequest { enabledAt }
    repository { nameWithOwner }
    author { login }
    commits(last: 1) {
      nodes { commit { oid statusCheckRollup { state } } }
    }
  }
`;

export interface PRUniverseCheck {
  checks: Record<string, PRBroadCheck>;
  buckets: {
    mine: string[];
    review: string[];
  };
  rateLimit?: {
    cost: number;
    remaining: number;
    resetAt: string;
  };
}

export interface PRHydration {
  pr: PRStatus;
  broad: PRBroadCheck;
  decision: PRDecisionCheck;
}

/** One thin discovery/check pass for the active PR universe. Search buckets
 *  discover authored/review-requested PRs; explicit refs cover watched and
 *  workspace-linked PRs. Returns signatures only — callers decide which PRs
 *  need detail hydration from the local cache state. */
export async function checkPRUniverse(
  wingId: string,
  explicitRefs: ReadonlyArray<{ repo: string; number: number }>,
): Promise<PRUniverseCheck | null> {
  const scope = await wingRepoScope(wingId);
  const includeSearchBuckets = scope !== null;
  if (!includeSearchBuckets && explicitRefs.length === 0) {
    return { checks: {}, buckets: { mine: [], review: [] } };
  }

  const since = isoDateNDaysAgo(90);
  const searchScope = scope ?? "";
  const authoredQ = `is:pr author:@me updated:>=${since} sort:updated-desc${searchScope}`;
  const reviewRequestedQ = `is:pr review-requested:@me updated:>=${since} sort:updated-desc${searchScope}`;
  const workChunks = chunkRefs(explicitRefs, 50);
  if (workChunks.length === 0) workChunks.push([]);

  const checks: Record<string, PRBroadCheck> = {};
  const buckets = { mine: [] as string[], review: [] as string[] };
  let rateLimit: PRUniverseCheck["rateLimit"];

  const { ghPath } = getConfig();
  try {
    for (let chunkIndex = 0; chunkIndex < workChunks.length; chunkIndex++) {
      const refs = workChunks[chunkIndex];
      const includeBuckets = includeSearchBuckets && chunkIndex === 0;
      const aliasParts = refs.map((r, i) => {
        const [owner, name] = r.repo.split("/", 2);
        return `p${i}: repository(owner: ${gqlString(owner)}, name: ${gqlString(name)}) {
          pullRequest(number: ${r.number}) { ${PR_FIELDS_BROAD_CHECK} }
        }`;
      });

      const bucketParts = includeBuckets
        ? `
          authored: search(query: ${gqlString(authoredQ)}, type: ISSUE, first: 30) {
            edges { node { ${PR_FIELDS_BROAD_CHECK} } }
          }
          reviewRequested: search(query: ${gqlString(reviewRequestedQ)}, type: ISSUE, first: 30) {
            edges { node { ${PR_FIELDS_BROAD_CHECK} } }
          }
        `
        : "";
      const query = `query {
        ${bucketParts}
        ${aliasParts.join("\n")}
        rateLimit { cost remaining resetAt }
      }`;

      const { stdout } = await execFileAsync(ghPath, [
        "api",
        "graphql",
        "-f",
        `query=${query}`,
      ]);
      const data = JSON.parse(stdout);
      if (data.errors) {
        console.error("[github] checkPRUniverse errors:", data.errors);
      }
      rateLimit = data.data?.rateLimit ?? rateLimit;

      if (includeBuckets) {
        const extractBucket = (key: string): string[] =>
          (data.data?.[key]?.edges ?? [])
            .map((e: any) => mapNodeBroadCheck(e.node))
            .filter(
              (n: PRBroadCheck | null): n is PRBroadCheck => n !== null,
            )
            .map((check: PRBroadCheck) => {
              checks[check.key] = check;
              return check.key;
            });
        buckets.mine = extractBucket("authored");
        buckets.review = extractBucket("reviewRequested");
      }

      refs.forEach((_, i) => {
        const check = mapNodeBroadCheck(data.data?.[`p${i}`]?.pullRequest);
        if (check) checks[check.key] = check;
      });
    }

    return { checks, buckets, rateLimit };
  } catch (err) {
    console.error("[github] checkPRUniverse failed:", err);
    return null;
  }
}

/** Expensive-but-important decision fields for hot/open PRs only. */
export async function checkPRDecisions(
  refs: ReadonlyArray<{ repo: string; number: number }>,
): Promise<Record<string, PRDecisionCheck> | null> {
  if (refs.length === 0) return {};

  const checks: Record<string, PRDecisionCheck> = {};
  const chunks = chunkRefs(refs, 25);
  const { ghPath } = getConfig();

  try {
    for (const chunk of chunks) {
      const aliasParts = chunk.map((r, i) => {
        const [owner, name] = r.repo.split("/", 2);
        return `p${i}: repository(owner: ${gqlString(owner)}, name: ${gqlString(name)}) {
          pullRequest(number: ${r.number}) { ${PR_FIELDS_DECISION_CHECK} }
        }`;
      });
      const query = `query {
        ${aliasParts.join("\n")}
        rateLimit { cost remaining resetAt }
      }`;

      const { stdout } = await execFileAsync(ghPath, [
        "api",
        "graphql",
        "-f",
        `query=${query}`,
      ]);
      const data = JSON.parse(stdout);
      if (data.errors) {
        console.error("[github] checkPRDecisions errors:", data.errors);
      }

      chunk.forEach((_, i) => {
        const check = mapNodeDecisionCheck(data.data?.[`p${i}`]?.pullRequest);
        if (check) checks[check.key] = check;
      });
    }

    return checks;
  } catch (err) {
    console.error("[github] checkPRDecisions failed:", err);
    return null;
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

function isoDateNDaysAgo(n: number): string {
  const d = new Date(Date.now() - n * 24 * 60 * 60_000);
  return d.toISOString().slice(0, 10);
}

function parseGitRemote(url: string): string | null {
  const match = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  return match ? match[1] : null;
}

function gqlString(value: string): string {
  return JSON.stringify(value);
}

function chunkRefs<T>(items: ReadonlyArray<T>, size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function getDefaultRepo(wingId: string): Promise<string | null> {
  const rootDir = getWingProjectDir(wingId);
  if (!rootDir) return null;
  const repos = await getReposInDirectory(rootDir);
  return repos.length > 0 ? repos[0].repo : null;
}

export async function hydratePR(
  repo: string,
  number: number,
): Promise<PRHydration | null> {
  const [owner, name] = repo.split("/", 2);
  if (!owner || !name) return null;

  const query = `
    query {
      repository(owner: ${gqlString(owner)}, name: ${gqlString(name)}) {
        pullRequest(number: ${number}) { ${PR_FIELDS_DETAIL} }
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
      console.error("[github] hydratePR errors:", data.errors);
    }
    const node = data.data?.repository?.pullRequest;
    if (!node?.number) return null;
    const broad = mapNodeBroadCheck(node);
    const decision = mapNodeDecisionCheck(node);
    if (!broad || !decision) return null;

    return {
      pr: mapNodeLite(node),
      broad,
      decision,
    };
  } catch (err) {
    console.error("[github] hydratePR failed:", err);
    return null;
  }
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
    state: (node.state ?? "OPEN").toLowerCase() as PRStatus["state"],
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

function mapNodeBroadCheck(node: any): PRBroadCheck | null {
  if (!node || node.number == null) return null;
  const repo = node.repository?.nameWithOwner ?? "";
  if (!repo) return null;
  const state = (node.state ?? "OPEN").toLowerCase() as PRStatus["state"];
  return {
    key: prKey(repo, node.number),
    repo,
    number: node.number,
    githubId: node.id ?? undefined,
    updatedAt: node.updatedAt ?? undefined,
    state,
    pr: mapNodeLite(node),
    broadSignature: broadSignatureForNode(node),
  };
}

function mapNodeDecisionCheck(node: any): PRDecisionCheck | null {
  if (!node || node.number == null) return null;
  const repo = node.repository?.nameWithOwner ?? "";
  if (!repo) return null;
  return {
    key: prKey(repo, node.number),
    repo,
    number: node.number,
    githubId: node.id ?? undefined,
    updatedAt: node.updatedAt ?? undefined,
    decisionSignature: decisionSignatureForNode(node),
  };
}

function broadSignatureForNode(node: any): string {
  return [
    node.id ?? "",
    node.updatedAt ?? "",
    node.state ?? "",
    node.isDraft ? "draft" : "ready",
    node.headRefOid ?? "",
  ].join("|");
}

function decisionSignatureForNode(node: any): string {
  const commit = node.commits?.nodes?.[0]?.commit;
  const ciState = commit?.statusCheckRollup?.state ?? "";
  return [
    node.id ?? "",
    node.reviewDecision ?? "",
    node.mergeStateStatus ?? "",
    node.autoMergeRequest?.enabledAt ?? "",
    commit?.oid ?? "",
    ciState,
  ].join("|");
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

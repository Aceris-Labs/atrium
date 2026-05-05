import { execFile, exec } from "child_process";
import { promisify } from "util";
import { readdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getConfig, getWingProjectDir } from "./store";
import type { PRStatus, RepoInfo } from "../shared/types";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

async function gql(searchQuery: string): Promise<PRStatus[]> {
  const { ghPath } = getConfig();

  const query = `
    query {
      viewer { login }
      search(query: "${searchQuery}", type: ISSUE, first: 50) {
        edges {
          node {
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
              reviewThreads(first: 100) {
                totalCount
                nodes {
                  isResolved
                  comments(last: 1) {
                    nodes { author { login } }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  try {
    const { stdout } = await execFileAsync(ghPath, [
      "api",
      "graphql",
      "-f",
      `query=${query}`,
    ]);
    const data = JSON.parse(stdout);
    const viewerLogin: string | null = data.data.viewer?.login ?? null;
    return data.data.search.edges
      .map((e: any) => e.node)
      .filter((n: any) => n?.number != null)
      .map((n: any) => mapNode(n, viewerLogin));
  } catch {
    return [];
  }
}

export async function listMyPRs(wingId: string): Promise<PRStatus[]> {
  return scopedPRQuery(wingId, "is:pr is:open author:@me");
}

export async function listReviewRequests(wingId: string): Promise<PRStatus[]> {
  return scopedPRQuery(wingId, "is:pr is:open review-requested:@me");
}

/** PRs the viewer has commented on or reviewed (but isn't necessarily a
 *  current requested reviewer). Used to surface threads awaiting reply on
 *  PRs the user voluntarily reviewed. */
export async function listReviewedPRs(wingId: string): Promise<PRStatus[]> {
  return scopedPRQuery(wingId, "is:pr is:open reviewed-by:@me -author:@me");
}

async function scopedPRQuery(
  wingId: string,
  baseQuery: string,
): Promise<PRStatus[]> {
  const rootDir = getWingProjectDir(wingId);

  // No root dir configured → unbounded query across all of GitHub.
  if (!rootDir) return gql(baseQuery);

  // Root dir configured but no repos found → deliberately return nothing.
  const repos = await getReposInDirectory(rootDir);
  if (repos.length === 0) return [];

  // Always scope to the exact repos in the wing dir — using `org:` would
  // pull in PRs from sibling repos that aren't part of this wing.
  const scope = " " + repos.map((r) => `repo:${r.repo}`).join(" ");
  return gql(baseQuery + scope);
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

function mapNode(node: any, viewerLogin: string | null): PRStatus {
  const ciState =
    node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null;
  const threads = node.reviewThreads?.nodes ?? [];
  const unresolvedThreads = threads.filter((t: any) => !t.isResolved);
  const openComments = unresolvedThreads.length;
  const threadsAwaitingYou = viewerLogin
    ? unresolvedThreads.filter((t: any) => {
        const lastAuthor = t.comments?.nodes?.[0]?.author?.login;
        return lastAuthor && lastAuthor !== viewerLogin;
      }).length
    : 0;
  return {
    number: node.number,
    title: node.title,
    state: "open",
    url: node.url,
    isDraft: node.isDraft ?? false,
    ciStatus: mapCIState(ciState),
    reviewDecision: node.reviewDecision ?? null,
    openComments,
    threadsAwaitingYou,
    mergeState: node.mergeStateStatus ?? undefined,
    autoMerge: !!node.autoMergeRequest,
    author: node.author?.login,
    repo: node.repository?.nameWithOwner,
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

import { execFile, spawnSync } from "child_process";
import { promisify } from "util";
import { findGhPath } from "./strategy";
import { err, nowIso } from "./types";
import type { Connector } from "./types";

export type GithubConfig = Record<string, never>;

const execFileAsync = promisify(execFile);

// Matches PRs and issues: github.com/owner/repo/pull/123 or /issues/123
const GITHUB_URL_RE = /github\.com\/([^/]+)\/([^/]+)\/(pull|issues?)\/(\d+)/;

interface GhPROrIssue {
  number?: number;
  title?: string;
  state?: string;
  draft?: boolean;
  user?: { login?: string };
  updated_at?: string;
}

function mapState(
  state: string,
  draft: boolean,
): { status: string; statusKind: "open" | "done" | "in-progress" } {
  const s = state.toUpperCase();
  if (s === "MERGED") return { status: "Merged", statusKind: "done" };
  if (s === "CLOSED") return { status: "Closed", statusKind: "done" };
  if (draft) return { status: "Draft", statusKind: "in-progress" };
  return { status: "Open", statusKind: "open" };
}

export const githubConnector: Connector<GithubConfig> = {
  source: "github",
  secretFields: [],

  match(url) {
    return GITHUB_URL_RE.test(url);
  },

  async hydrate(url, _config) {
    const m = url.match(GITHUB_URL_RE);
    if (!m) return err("unsupported");
    const [, owner, repo, type, num] = m;

    const ghPath = findGhPath();
    if (!ghPath) return err("not-configured");

    // REST endpoint differs for PRs vs issues
    const endpoint =
      type === "pull"
        ? `repos/${owner}/${repo}/pulls/${num}`
        : `repos/${owner}/${repo}/issues/${num}`;

    try {
      const { stdout } = await execFileAsync(ghPath, ["api", endpoint], {
        timeout: 8000,
      });
      const data = JSON.parse(stdout) as GhPROrIssue;
      const { status, statusKind } = mapState(
        data.state ?? "",
        data.draft ?? false,
      );
      return {
        title: data.title,
        status,
        statusKind,
        identifier: `#${data.number ?? num}`,
        authorName: data.user?.login,
        updatedAt: data.updated_at,
        fetchedAt: nowIso(),
      };
    } catch (e) {
      const msg = String(e);
      if (msg.includes("401") || msg.includes("403")) return err("auth");
      if (msg.includes("404")) return err("not-found");
      return err("network");
    }
  },

  async test(_config) {
    const ghPath = findGhPath();
    if (!ghPath) {
      return {
        ok: false,
        error: "gh CLI not found — install with: brew install gh",
      };
    }

    const auth = spawnSync(ghPath, ["auth", "status"], { encoding: "utf-8" });
    if (auth.status !== 0) {
      return { ok: false, error: "Not authenticated — run: gh auth login" };
    }

    const text = auth.stdout + auth.stderr;
    const match = text.match(/account\s+(\S+)/i);
    return { ok: true, identity: match?.[1] };
  },

  checkConfigured() {
    const ghPath = findGhPath();
    if (!ghPath) return false;
    const auth = spawnSync(ghPath, ["auth", "status"], { encoding: "utf-8" });
    return auth.status === 0;
  },
};

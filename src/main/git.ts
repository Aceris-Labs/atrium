import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { GitRepoInfo } from "../shared/types";

function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

export function detectRepo(dirPath: string): GitRepoInfo {
  if (!dirPath) return { isRepo: false };
  const expanded = expandTilde(dirPath);
  if (!existsSync(expanded)) return { isRepo: false };

  const inside = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: expanded,
    encoding: "utf-8",
  });
  if (inside.status !== 0 || inside.stdout.trim() !== "true") {
    return { isRepo: false };
  }

  const branchResult = spawnSync(
    "git",
    ["branch", "--format=%(refname:short)"],
    {
      cwd: expanded,
      encoding: "utf-8",
    },
  );
  const branches =
    branchResult.status === 0
      ? branchResult.stdout
          .split("\n")
          .map((b) => b.trim())
          .filter(Boolean)
      : [];

  const headResult = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: expanded,
    encoding: "utf-8",
  });
  const currentBranch =
    headResult.status === 0 ? headResult.stdout.trim() : undefined;

  return { isRepo: true, currentBranch, branches };
}

/** Returns the current HEAD branch in `dir`, or null if not a repo / detached. */
export function currentBranch(dir: string): string | null {
  const expanded = expandTilde(dir);
  if (!existsSync(expanded)) return null;
  const result = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: expanded,
    encoding: "utf-8",
  });
  if (result.status !== 0) return null;
  const head = result.stdout.trim();
  if (!head || head === "HEAD") return null;
  return head;
}

/** Attempts `git checkout <branch>` in `dir`. Returns null on success or the
 *  trimmed stderr on failure. Caller should surface the error message. */
export function checkoutBranch(dir: string, branch: string): string | null {
  const expanded = expandTilde(dir);
  const result = spawnSync("git", ["checkout", branch], {
    cwd: expanded,
    encoding: "utf-8",
  });
  if (result.status === 0) return null;
  return (result.stderr || result.stdout || "git checkout failed").trim();
}

export interface WorktreeInfo {
  path: string;
  branch?: string;
  isMain: boolean;
}

/** Lists git worktrees registered in `dir`'s repo. Excludes detached/locked
 *  states beyond the basics — Atrium just needs path + branch for the picker. */
export function listWorktrees(dir: string): WorktreeInfo[] {
  const expanded = expandTilde(dir);
  if (!existsSync(expanded)) return [];
  const result = spawnSync("git", ["worktree", "list", "--porcelain"], {
    cwd: expanded,
    encoding: "utf-8",
  });
  if (result.status !== 0) return [];
  const blocks = result.stdout.split("\n\n").filter(Boolean);
  const wts: WorktreeInfo[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i].split("\n");
    let path: string | undefined;
    let branch: string | undefined;
    for (const line of lines) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
      else if (line.startsWith("branch refs/heads/"))
        branch = line.slice("branch refs/heads/".length);
    }
    if (path) wts.push({ path, branch, isMain: i === 0 });
  }
  return wts;
}

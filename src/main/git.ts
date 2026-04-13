import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { GitRepoInfo, GitCheckoutResult } from "../shared/types";

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

export function checkoutBranch(
  dirPath: string,
  branch: string,
): GitCheckoutResult {
  if (!dirPath || !branch)
    return { ok: false, error: "missing path or branch" };
  const expanded = expandTilde(dirPath);
  if (!existsSync(expanded))
    return { ok: false, error: "directory does not exist" };

  const result = spawnSync("git", ["checkout", branch], {
    cwd: expanded,
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    return {
      ok: false,
      error: (result.stderr || result.stdout || "git checkout failed").trim(),
    };
  }
  return { ok: true };
}

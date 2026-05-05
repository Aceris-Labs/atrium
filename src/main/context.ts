import type { Workspace } from "../shared/types";

/** Renders a workspace into the markdown blob we hand off as launch context.
 *  Pure formatter — no IO. The caller passes the data it already has. */
export function buildWorkspaceContextMarkdown(
  workspace: Workspace,
  wingName: string,
  wingId: string,
): string {
  const lines: string[] = [
    `# Workspace: ${workspace.title}`,
    "",
    `You are operating in the Atrium workspace **"${workspace.title}"** (id: \`${workspace.id}\`) inside wing **${wingName}** (id: \`${wingId}\`). When tools ask which workspace you're in, this is it.`,
    "",
  ];

  const metaParts: string[] = [];
  metaParts.push(`type: ${workspace.type}`);
  metaParts.push(`status: ${workspace.status}`);
  if (workspace.repo) metaParts.push(`repo: ${workspace.repo}`);
  if (workspace.branch) metaParts.push(`branch: ${workspace.branch}`);
  if (workspace.worktree) {
    metaParts.push(`worktree: ${workspace.worktree.path}`);
  }
  lines.push(metaParts.join(" · "), "");

  if (workspace.about?.trim()) {
    lines.push("## About", workspace.about.trim(), "");
  }

  if (workspace.recap?.text?.trim()) {
    lines.push(
      `## Latest recap (${workspace.recap.capturedAt})`,
      workspace.recap.text.trim(),
      "",
    );
  }

  if (workspace.digest?.text?.trim()) {
    lines.push(
      `## Agent digest (${workspace.digest.generatedAt})`,
      workspace.digest.text.trim(),
      "",
    );
  }

  if (workspace.prs.length > 0) {
    lines.push("## Linked PRs");
    workspace.prs.forEach((p) => lines.push(`- ${p.repo}#${p.number}`));
    lines.push("");
  }

  const items = workspace.items ?? [];
  if (items.length > 0) {
    lines.push("## Items");
    for (const item of items) {
      const checkbox = item.done ? "[x]" : "[ ]";
      lines.push(`- ${checkbox} ${item.title}`);
      if (item.body) {
        for (const bodyLine of item.body.split("\n")) {
          lines.push(`  ${bodyLine}`);
        }
      }
    }
    lines.push("");
  }

  const links = workspace.links ?? [];
  if (links.length > 0) {
    lines.push("## Links");
    for (const link of links) {
      lines.push(`- [${link.source}] ${link.label} → ${link.url}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

import { spawn } from "child_process";
import type { Workspace, PRStatus, LinkStatus } from "../../shared/types";
import { findClaudePath } from "../connectors/strategy";

function buildPrompt(
  workspace: Workspace,
  prStatuses: PRStatus[],
  linkStatuses: Record<string, LinkStatus>,
): string {
  const linkedPRs = workspace.prs
    .map((wp) =>
      prStatuses.find((p) => p.repo === wp.repo && p.number === wp.number),
    )
    .filter((p): p is PRStatus => p !== undefined);

  const prLines =
    linkedPRs.length > 0
      ? linkedPRs
          .map((pr) => {
            const parts = [`#${pr.number} "${pr.title}"`, pr.state];
            if (pr.state === "open") {
              if (pr.ciStatus !== "unknown") parts.push(`CI ${pr.ciStatus}`);
              if (pr.reviewDecision)
                parts.push(pr.reviewDecision.toLowerCase().replace(/_/g, " "));
              if (pr.isDraft) parts.push("draft");
            }
            return `- ${parts.join(", ")}`;
          })
          .join("\n")
      : "None";

  const todos = workspace.todos ?? [];
  const doneCount = todos.filter((t) => t.done).length;
  const todoLines =
    todos.length > 0
      ? todos.map((t) => `- [${t.done ? "x" : " "}] ${t.text}`).join("\n")
      : "None";

  const notes = workspace.notes ?? [];
  const noteLines =
    notes.length > 0 ? notes.map((n) => `- ${n.text}`).join("\n") : "None";

  const links = workspace.links ?? [];
  const linkLines =
    links.length > 0
      ? links
          .map((l) => {
            const h = linkStatuses[l.url];
            const label = h?.title || l.label;
            const meta: string[] = [];
            if (h?.status) meta.push(h.status);
            if (h?.assignee) meta.push(`assigned to ${h.assignee}`);
            const metaStr = meta.length ? ` (${meta.join(", ")})` : "";
            return `- [${l.source}] ${label}${metaStr} → ${l.url}`;
          })
          .join("\n")
      : "None";

  const linkInstruction =
    links.length > 0
      ? `\nBefore writing the summary, use available MCP tools to fetch the content of each linked resource (issue descriptions, document bodies, thread text, etc.). If a tool is unavailable for a link, skip it and rely on the metadata above.\n`
      : "";

  return `You are summarizing a software workspace for an engineer.
${linkInstruction}
Workspace: "${workspace.title}" (${workspace.type}, ${workspace.status})
Branch: ${workspace.branch || "none"}
Directory: ${workspace.directoryPath || "none"}

Pull Requests:
${prLines}

Todos (${doneCount}/${todos.length} done):
${todoLines}

Notes:
${noteLines}

Links:
${linkLines}

Write a concise markdown summary (2–4 short paragraphs) covering:
1. What this workspace is working on
2. Current state and progress
3. Any blockers, open questions, or next steps

Be specific — use the actual PR titles, ticket names, todo items, and content from the linked resources. Do not pad with filler or repeat the raw data verbatim.`;
}

function buildWingPrompt(
  workspaces: Workspace[],
  prStatuses: PRStatus[],
  linkStatuses: Record<string, LinkStatus>,
): string {
  const sections = workspaces.map((workspace) => {
    const linkedPRs = workspace.prs
      .map((wp) =>
        prStatuses.find((p) => p.repo === wp.repo && p.number === wp.number),
      )
      .filter((p): p is PRStatus => p !== undefined);

    const prLines =
      linkedPRs.length > 0
        ? linkedPRs
            .map((pr) => {
              const parts = [`#${pr.number} "${pr.title}"`, pr.state];
              if (pr.state === "open") {
                if (pr.ciStatus !== "unknown") parts.push(`CI ${pr.ciStatus}`);
                if (pr.reviewDecision)
                  parts.push(
                    pr.reviewDecision.toLowerCase().replace(/_/g, " "),
                  );
                if (pr.isDraft) parts.push("draft");
              }
              return `  - ${parts.join(", ")}`;
            })
            .join("\n")
        : "  None";

    const todos = workspace.todos ?? [];
    const doneCount = todos.filter((t) => t.done).length;
    const todoLines =
      todos.length > 0
        ? todos.map((t) => `  - [${t.done ? "x" : " "}] ${t.text}`).join("\n")
        : "  None";

    const notes = workspace.notes ?? [];
    const noteLines =
      notes.length > 0
        ? notes.map((n) => `  - ${n.text}`).join("\n")
        : "  None";

    const links = workspace.links ?? [];
    const linkLines =
      links.length > 0
        ? links
            .map((l) => {
              const h = linkStatuses[l.url];
              const label = h?.title || l.label;
              const meta: string[] = [];
              if (h?.status) meta.push(h.status);
              if (h?.assignee) meta.push(`assigned to ${h.assignee}`);
              const metaStr = meta.length ? ` (${meta.join(", ")})` : "";
              return `  - [${l.source}] ${label}${metaStr} → ${l.url}`;
            })
            .join("\n")
        : "  None";

    const about = workspace.about ? `\n  About: ${workspace.about}` : "";

    return `### ${workspace.title} (${workspace.type}, ${workspace.status})${about}
  Branch: ${workspace.branch || "none"}
  PRs:
${prLines}
  Todos (${doneCount}/${todos.length} done):
${todoLines}
  Notes:
${noteLines}
  Links:
${linkLines}`;
  });

  const allLinks = workspaces.flatMap((w) => w.links ?? []);
  const linkInstruction =
    allLinks.length > 0
      ? `Before writing the summary, use available MCP tools to fetch the content of each linked resource listed under the spaces below (issue descriptions, document bodies, thread text, etc.). If a tool is unavailable for a link, skip it and rely on the metadata provided.\n\n`
      : "";

  return `You are summarizing all active work in a software engineering wing for an engineer.

${linkInstruction}${sections.join("\n\n")}

Write a concise markdown summary of the entire wing's work. Structure it as:
1. **Overview** — 1–2 sentences on what this wing is collectively working on
2. **By Space** — a brief (2–3 sentence) status for each space, focusing on what's happening now
3. **Blockers & Cross-cutting Concerns** — any blockers, dependencies between spaces, or shared risks (omit this section if none)
4. **Next Steps** — 3–5 prioritized action items across the wing

Be specific — use actual PR titles, ticket names, todo items, and content from the linked resources. Skip filler. If a section has nothing meaningful, omit it.`;
}

/**
 * Generate a markdown summary of multiple workspaces in a wing by spawning the
 * claude CLI. Returns the summary text.
 */
export async function generateWingSummary(
  workspaces: Workspace[],
  prStatuses: PRStatus[],
  linkStatuses: Record<string, LinkStatus>,
): Promise<string> {
  const claudePath = findClaudePath();
  if (!claudePath) throw new Error("claude CLI not found");

  const prompt = buildWingPrompt(workspaces, prStatuses, linkStatuses);

  return new Promise((resolve, reject) => {
    const proc = spawn(claudePath, ["-p", prompt, "--output-format", "json"]);

    let stdout = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("summary timed out"));
    }, 120_000);

    proc.on("close", (code: number | null) => {
      clearTimeout(timer);
      if (code !== 0 || !stdout) {
        reject(new Error("claude exited with error"));
        return;
      }
      let envelope: { result?: string; is_error?: boolean };
      try {
        envelope = JSON.parse(stdout) as typeof envelope;
      } catch {
        reject(new Error("failed to parse claude output"));
        return;
      }
      if (envelope.is_error || !envelope.result) {
        reject(new Error("claude returned an error"));
        return;
      }
      resolve(envelope.result.trim());
    });
  });
}

/**
 * Generate a plain-text markdown summary of the workspace by spawning the
 * claude CLI with a structured prompt. Returns the summary text.
 */
export async function generateWorkspaceDigest(
  workspace: Workspace,
  prStatuses: PRStatus[],
  linkStatuses: Record<string, LinkStatus>,
): Promise<string> {
  const claudePath = findClaudePath();
  if (!claudePath) throw new Error("claude CLI not found");

  const prompt = buildPrompt(workspace, prStatuses, linkStatuses);

  return new Promise((resolve, reject) => {
    const proc = spawn(claudePath, ["-p", prompt, "--output-format", "json"]);

    let stdout = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("digest timed out"));
    }, 120_000);

    proc.on("close", (code: number | null) => {
      clearTimeout(timer);
      if (code !== 0 || !stdout) {
        reject(new Error("claude exited with error"));
        return;
      }
      let envelope: { result?: string; is_error?: boolean };
      try {
        envelope = JSON.parse(stdout) as typeof envelope;
      } catch {
        reject(new Error("failed to parse claude output"));
        return;
      }
      if (envelope.is_error || !envelope.result) {
        reject(new Error("claude returned an error"));
        return;
      }
      resolve(envelope.result.trim());
    });
  });
}

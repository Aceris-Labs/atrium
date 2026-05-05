/**
 * Atrium MCP server (stdio).
 *
 * Agent-agnostic: speaks the Model Context Protocol over stdio, so any client
 * (Claude Code, Codex, Cursor, Continue…) can spawn it via their MCP config.
 *
 * Reads/writes ~/.atrium/ directly via the same store helpers the Electron
 * app uses. Atomic writes (temp+rename) plus the app's fs.watch keep state
 * consistent across the CLI/agent/Electron-app boundary.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { listWings, listWorkspaces, updateWorkspace } from "../main/store.js";
import { buildWorkspaceContextMarkdown } from "../main/context.js";
import type {
  Item,
  LinkCategory,
  Wing,
  Workspace,
  WorkspaceLink,
} from "../shared/types.js";

// ── Resolution ─────────────────────────────────────────────────────────────

interface Resolved {
  wing: Wing;
  workspace: Workspace;
}

/** Locate the wing+workspace whose worktree (or projectDir) is an ancestor of
 *  the given directory. Walks all wings; first match wins. */
function resolveByCwd(cwd: string): Resolved | null {
  const wings = listWings();
  let best: { wing: Wing; workspace: Workspace; depth: number } | null = null;
  for (const wing of wings) {
    const workspaces = listWorkspaces(wing.id);
    for (const ws of workspaces) {
      const path = ws.worktree?.path;
      if (!path) continue;
      const expanded = expandTilde(path);
      if (cwd === expanded || cwd.startsWith(expanded + "/")) {
        const depth = expanded.split("/").length;
        if (!best || depth > best.depth) {
          best = { wing, workspace: ws, depth };
        }
      }
    }
  }
  if (best) return { wing: best.wing, workspace: best.workspace };

  // Fall back to the wing whose projectDir contains cwd (no specific space)
  for (const wing of wings) {
    if (!wing.projectDir) continue;
    const expanded = expandTilde(wing.projectDir);
    if (cwd === expanded || cwd.startsWith(expanded + "/")) {
      const workspaces = listWorkspaces(wing.id);
      // No workspace match — return the first space in the wing as a hint
      if (workspaces[0]) return { wing, workspace: workspaces[0] };
    }
  }
  return null;
}

function expandTilde(p: string): string {
  if (p === "~") return process.env.HOME ?? p;
  if (p.startsWith("~/")) return `${process.env.HOME ?? "~"}/${p.slice(2)}`;
  return p;
}

/** Resolve a (wing, workspace) pair from explicit IDs (when provided) or the
 *  agent's cwd (when omitted). Throws a user-readable error if it can't. */
function resolve(
  wingId: string | undefined,
  workspaceId: string | undefined,
): Resolved {
  if (wingId && workspaceId) {
    const wing = listWings().find((w) => w.id === wingId);
    if (!wing) throw new Error(`Wing not found: ${wingId}`);
    const workspace = listWorkspaces(wingId).find((w) => w.id === workspaceId);
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
    return { wing, workspace };
  }
  const cwdMatch = resolveByCwd(process.cwd());
  if (!cwdMatch) {
    throw new Error(
      `Could not infer the active workspace from cwd (${process.cwd()}). Pass wing_id and workspace_id explicitly, or call atrium_resolve_current first.`,
    );
  }
  return cwdMatch;
}

// ── Server setup ───────────────────────────────────────────────────────────

const server = new McpServer({ name: "atrium", version: "0.1.0" });

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function json(value: unknown) {
  return ok(JSON.stringify(value, null, 2));
}

// ── Read tools ─────────────────────────────────────────────────────────────

server.registerTool(
  "atrium_resolve_current",
  {
    description:
      "Identify the Atrium wing and workspace the current process belongs to, based on cwd. Useful before calling other tools without explicit IDs.",
    inputSchema: {},
  },
  async () => {
    const r = resolveByCwd(process.cwd());
    if (!r) {
      return json({
        resolved: false,
        cwd: process.cwd(),
        reason:
          "No wing or workspace matches this directory. List wings with atrium_list_wings.",
      });
    }
    return json({
      resolved: true,
      wing: { id: r.wing.id, name: r.wing.name, projectDir: r.wing.projectDir },
      workspace: {
        id: r.workspace.id,
        title: r.workspace.title,
        type: r.workspace.type,
        status: r.workspace.status,
      },
    });
  },
);

server.registerTool(
  "atrium_list_wings",
  {
    description: "List all wings (top-level groupings of workspaces).",
    inputSchema: {},
  },
  async () => {
    return json(
      listWings().map((w) => ({
        id: w.id,
        name: w.name,
        projectDir: w.projectDir,
      })),
    );
  },
);

server.registerTool(
  "atrium_list_workspaces",
  {
    description:
      "List workspaces in a wing. Defaults to the wing inferred from cwd.",
    inputSchema: {
      wing_id: z.string().optional(),
    },
  },
  async ({ wing_id }) => {
    const id = wing_id ?? resolveByCwd(process.cwd())?.wing.id;
    if (!id) throw new Error("No wing_id and could not infer one from cwd.");
    return json(
      listWorkspaces(id).map((w) => ({
        id: w.id,
        title: w.title,
        type: w.type,
        status: w.status,
        branch: w.branch,
        worktree: w.worktree?.path,
        openItemCount: (w.items ?? []).filter((i) => !i.done).length,
        prCount: w.prs.length,
      })),
    );
  },
);

server.registerTool(
  "atrium_get_workspace",
  {
    description:
      "Get the full record for a workspace. Defaults to the workspace inferred from cwd.",
    inputSchema: {
      wing_id: z.string().optional(),
      workspace_id: z.string().optional(),
    },
  },
  async ({ wing_id, workspace_id }) => {
    const { workspace } = resolve(wing_id, workspace_id);
    return json(workspace);
  },
);

server.registerTool(
  "atrium_get_workspace_context",
  {
    description:
      "Render the workspace as the same markdown context Atrium injects at launch (about, recap, digest, PRs, items, links). Call this when you need a fresh snapshot of what's going on in this space.",
    inputSchema: {
      wing_id: z.string().optional(),
      workspace_id: z.string().optional(),
    },
  },
  async ({ wing_id, workspace_id }) => {
    const { wing, workspace } = resolve(wing_id, workspace_id);
    return ok(buildWorkspaceContextMarkdown(workspace, wing.name, wing.id));
  },
);

server.registerTool(
  "atrium_get_recap",
  {
    description:
      "Get the latest auto-captured 'away_summary' recap for a workspace, if any.",
    inputSchema: {
      wing_id: z.string().optional(),
      workspace_id: z.string().optional(),
    },
  },
  async ({ wing_id, workspace_id }) => {
    const { workspace } = resolve(wing_id, workspace_id);
    return json(workspace.recap ?? null);
  },
);

server.registerTool(
  "atrium_get_digest",
  {
    description:
      "Get the user-triggered AI digest for a workspace, if one has been generated.",
    inputSchema: {
      wing_id: z.string().optional(),
      workspace_id: z.string().optional(),
    },
  },
  async ({ wing_id, workspace_id }) => {
    const { workspace } = resolve(wing_id, workspace_id);
    return json(workspace.digest ?? null);
  },
);

// ── Mutation tools ─────────────────────────────────────────────────────────

server.registerTool(
  "atrium_add_item",
  {
    description:
      "Create a new checkable to-do item in a workspace. Use this ONLY for actionable tasks the user wants to track and check off. Do NOT use this for: (a) Linear/Jira/Notion/GitHub URLs the user wants attached for reference — use `atrium_add_link` instead; (b) freeform notes or decisions — use `atrium_append_about`. Pass `body` for a multi-line markdown description on the item itself.",
    inputSchema: {
      title: z.string().min(1),
      body: z.string().optional(),
      done: z.boolean().optional(),
      wing_id: z.string().optional(),
      workspace_id: z.string().optional(),
    },
  },
  async ({ title, body, done, wing_id, workspace_id }) => {
    const { wing, workspace } = resolve(wing_id, workspace_id);
    const now = new Date().toISOString();
    const item: Item = {
      id: globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title,
      body,
      done: done ?? false,
      createdAt: now,
      updatedAt: now,
    };
    const next: Workspace = {
      ...workspace,
      items: [item, ...(workspace.items ?? [])],
    };
    await updateWorkspace(wing.id, next);
    return json({ ok: true, item });
  },
);

server.registerTool(
  "atrium_set_item_done",
  {
    description:
      "Toggle an item's `done` state. Identify the item by its id (returned from atrium_get_workspace.items).",
    inputSchema: {
      item_id: z.string().min(1),
      done: z.boolean(),
      wing_id: z.string().optional(),
      workspace_id: z.string().optional(),
    },
  },
  async ({ item_id, done, wing_id, workspace_id }) => {
    const { wing, workspace } = resolve(wing_id, workspace_id);
    const items = workspace.items ?? [];
    const idx = items.findIndex((i) => i.id === item_id);
    if (idx === -1) throw new Error(`Item not found: ${item_id}`);
    const updated: Item = {
      ...items[idx],
      done,
      updatedAt: new Date().toISOString(),
    };
    const nextItems = [...items];
    nextItems[idx] = updated;
    await updateWorkspace(wing.id, { ...workspace, items: nextItems });
    return json({ ok: true, item: updated });
  },
);

server.registerTool(
  "atrium_update_item",
  {
    description:
      "Update an item's title and/or body. Use to revise, never to overwrite by accident.",
    inputSchema: {
      item_id: z.string().min(1),
      title: z.string().optional(),
      body: z.string().optional(),
      wing_id: z.string().optional(),
      workspace_id: z.string().optional(),
    },
  },
  async ({ item_id, title, body, wing_id, workspace_id }) => {
    const { wing, workspace } = resolve(wing_id, workspace_id);
    const items = workspace.items ?? [];
    const idx = items.findIndex((i) => i.id === item_id);
    if (idx === -1) throw new Error(`Item not found: ${item_id}`);
    const updated: Item = {
      ...items[idx],
      title: title ?? items[idx].title,
      body: body !== undefined ? body : items[idx].body,
      updatedAt: new Date().toISOString(),
    };
    const nextItems = [...items];
    nextItems[idx] = updated;
    await updateWorkspace(wing.id, { ...workspace, items: nextItems });
    return json({ ok: true, item: updated });
  },
);

function classifyUrl(url: string): {
  source: WorkspaceLink["source"];
  category: LinkCategory;
} {
  if (url.includes("notion.so") || url.includes("notion.site"))
    return { source: "notion", category: "docs" };
  if (url.includes("linear.app"))
    return { source: "linear", category: "tickets" };
  if (url.includes("github.com"))
    return { source: "github", category: "other" };
  if (url.includes("slack.com")) return { source: "slack", category: "other" };
  if (url.includes("discord.com"))
    return { source: "discord", category: "other" };
  if (url.includes("figma.com")) return { source: "figma", category: "docs" };
  if (url.includes("coda.io")) return { source: "coda", category: "docs" };
  if (url.includes("atlassian.net")) {
    if (url.includes("/wiki/"))
      return { source: "confluence", category: "docs" };
    return { source: "jira", category: "tickets" };
  }
  return { source: "other", category: "other" };
}

function deriveLinkLabel(url: string): string {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean);
    return segments[segments.length - 1]?.replace(/[-_]/g, " ") ?? u.hostname;
  } catch {
    return url;
  }
}

server.registerTool(
  "atrium_add_link",
  {
    description:
      "Attach an external URL to a workspace (Linear/Jira tickets, Notion/Confluence docs, GitHub PRs, Figma files, Slack threads, etc.). Use this whenever the user wants a link tracked on the space — NOT atrium_add_item. Source and category are auto-detected from the URL host; pass them explicitly only to override.",
    inputSchema: {
      url: z.string().min(1),
      label: z.string().optional(),
      source: z
        .enum([
          "notion",
          "linear",
          "github",
          "slack",
          "discord",
          "figma",
          "jira",
          "confluence",
          "coda",
          "other",
        ])
        .optional(),
      category: z.enum(["docs", "tickets", "other"]).optional(),
      wing_id: z.string().optional(),
      workspace_id: z.string().optional(),
    },
  },
  async ({ url, label, source, category, wing_id, workspace_id }) => {
    const { wing, workspace } = resolve(wing_id, workspace_id);
    const classified = classifyUrl(url);
    const link: WorkspaceLink = {
      id: globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      url,
      label: label ?? deriveLinkLabel(url),
      source: source ?? classified.source,
      category: category ?? classified.category,
    };
    const next: Workspace = {
      ...workspace,
      links: [...(workspace.links ?? []), link],
    };
    await updateWorkspace(wing.id, next);
    return json({ ok: true, link });
  },
);

server.registerTool(
  "atrium_append_about",
  {
    description:
      "Append a freeform note to the workspace's About field (timestamped). Use for decisions, context, or progress notes that aren't actionable to-dos. For actionable to-dos use `atrium_add_item`; for external URLs use `atrium_add_link`.",
    inputSchema: {
      text: z.string().min(1),
      wing_id: z.string().optional(),
      workspace_id: z.string().optional(),
    },
  },
  async ({ text, wing_id, workspace_id }) => {
    const { wing, workspace } = resolve(wing_id, workspace_id);
    const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
    const block = `\n\n### ${stamp}\n${text.trim()}`;
    const nextAbout = (workspace.about ?? "").trim() + block;
    await updateWorkspace(wing.id, { ...workspace, about: nextAbout });
    return json({ ok: true });
  },
);

// ── Run ────────────────────────────────────────────────────────────────────

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Stays alive until stdin closes; the client owns the lifecycle.
}

const sub = process.argv[2];
if (sub === "install" || sub === "uninstall" || sub === "status") {
  // Lazy-loaded so the server-mode startup stays minimal.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  import("./install.js").then((m) => m.run(sub, process.argv.slice(3)));
} else if (sub === "--help" || sub === "-h") {
  // eslint-disable-next-line no-console
  console.error(
    [
      "atrium-mcp — Atrium Model Context Protocol server",
      "",
      "Usage:",
      "  atrium-mcp                Run the MCP server over stdio (this is what your agent client invokes).",
      "  atrium-mcp install        Register this server with all detected MCP-aware agents.",
      "  atrium-mcp install <kind> Register with one specific agent: claude | codex | cursor.",
      "  atrium-mcp uninstall      Remove the registration from all detected agents.",
      "  atrium-mcp status         Show which agents currently have Atrium registered.",
    ].join("\n"),
  );
  process.exit(0);
} else {
  runServer().catch((e) => {
    // eslint-disable-next-line no-console
    console.error("[atrium-mcp] fatal:", e);
    process.exit(1);
  });
}

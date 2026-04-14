import type { ConnectorSource, LinkStatus } from "../../shared/types";
import { err, nowIso } from "../connectors/types";
import type { McpClient, McpTool } from "./client";

interface SourceHint {
  /** Tool name substrings to look for (any match wins) */
  namePatterns: string[];
  /** The input parameter key to pass the resource ID as */
  idParam: string;
  /** Extract the resource identifier from a URL */
  extractId: (url: string) => string | null;
}

// Per-source hints for finding the right MCP tool and mapping the response
const HINTS: Partial<Record<ConnectorSource, SourceHint>> = {
  linear: {
    namePatterns: ["issue", "get_issue", "linear_issue"],
    idParam: "id",
    extractId: (url) =>
      url.match(/linear\.app\/[^/]+\/issue\/([A-Z0-9]+-\d+)/)?.[1] ?? null,
  },
  notion: {
    namePatterns: ["page", "get_page", "retrieve_page", "notion_page"],
    idParam: "page_id",
    extractId: (url) => {
      const m = url.match(/notion\.so\/.*?([a-f0-9]{32})/);
      if (!m) return null;
      const id = m[1];
      // Convert 32-char hex to UUID format
      return [
        id.slice(0, 8),
        id.slice(8, 12),
        id.slice(12, 16),
        id.slice(16, 20),
        id.slice(20),
      ].join("-");
    },
  },
  jira: {
    namePatterns: ["issue", "get_issue", "jira_issue"],
    idParam: "issue_key",
    extractId: (url) => url.match(/browse\/([A-Z]+-\d+)/)?.[1] ?? null,
  },
  slack: {
    namePatterns: ["message", "get_message", "slack_message"],
    idParam: "channel",
    extractId: (url) => url.match(/archives\/(C[A-Z0-9]+)\//)?.[1] ?? null,
  },
  confluence: {
    namePatterns: ["confluence_page", "get_page", "confluence"],
    idParam: "page_id",
    extractId: (url) =>
      url.match(/atlassian\.net\/wiki\/.*\/pages\/(\d+)/)?.[1] ?? null,
  },
};

function findTool(tools: McpTool[], patterns: string[]): McpTool | undefined {
  const lower = patterns.map((p) => p.toLowerCase());
  return tools.find((t) => lower.some((p) => t.name.toLowerCase().includes(p)));
}

function mapLinear(data: Record<string, unknown>): LinkStatus | null {
  if (typeof data.identifier !== "string" || typeof data.title !== "string")
    return null;
  const state = data.state as Record<string, unknown> | undefined;
  const labels = (
    (data.labels as Record<string, unknown> | undefined)?.nodes as
      | Array<{ name?: string }>
      | undefined
  )
    ?.map((l) => l.name)
    .filter((n): n is string => !!n);
  const priorityLabel =
    typeof data.priorityLabel === "string" &&
    data.priorityLabel !== "No priority"
      ? data.priorityLabel
      : undefined;
  return {
    identifier: data.identifier,
    title: data.title,
    status: state?.name as string | undefined,
    assignee: (data.assignee as Record<string, unknown> | undefined)?.name as
      | string
      | undefined,
    updatedAt: data.updatedAt as string | undefined,
    priority: priorityLabel,
    labels: labels?.length ? labels : undefined,
    subtitle: (data.team as Record<string, unknown> | undefined)?.key as
      | string
      | undefined,
    commentCount: (data.comments as Record<string, unknown> | undefined)
      ?.totalCount as number | undefined,
    fetchedAt: nowIso(),
  };
}

function mapNotion(data: Record<string, unknown>): LinkStatus | null {
  if (data.object !== "page") return null;
  const titleProp = (data.properties as Record<string, unknown> | undefined)
    ?.title as Record<string, unknown> | undefined;
  const titleArr = titleProp?.title as
    | Array<{ plain_text?: string }>
    | undefined;
  const title =
    titleArr?.map((t) => t.plain_text).join("") ??
    (data.title as string) ??
    "Untitled";
  const icon = data.icon as
    | { type: string; emoji?: string; external?: { url: string } }
    | undefined;
  const iconValue =
    icon?.type === "emoji"
      ? icon.emoji
      : icon?.type === "external"
        ? icon.external?.url
        : undefined;
  const cover = data.cover as
    | { type: string; external?: { url: string }; file?: { url: string } }
    | undefined;
  const coverUrl =
    cover?.type === "external"
      ? cover.external?.url
      : cover?.type === "file"
        ? cover.file?.url
        : undefined;
  return {
    title,
    icon: iconValue,
    thumbnailUrl: coverUrl,
    updatedAt: data.last_edited_time as string | undefined,
    authorName: (data.last_edited_by as Record<string, unknown> | undefined)
      ?.name as string | undefined,
    fetchedAt: nowIso(),
  };
}

function mapJira(data: Record<string, unknown>): LinkStatus | null {
  if (typeof data.key !== "string") return null;
  const fields = data.fields as Record<string, unknown> | undefined;
  if (!fields) return null;
  const status = fields.status as Record<string, unknown> | undefined;
  const priority = fields.priority as Record<string, unknown> | undefined;
  const issuetype = fields.issuetype as Record<string, unknown> | undefined;
  const labels = (fields.labels as string[] | undefined)?.filter(Boolean);
  const components = fields.components as Array<{ name?: string }> | undefined;
  return {
    identifier: data.key,
    title: (fields.summary as string) ?? data.key,
    status: status?.name as string | undefined,
    assignee: (fields.assignee as Record<string, unknown> | undefined)
      ?.displayName as string | undefined,
    updatedAt: fields.updated as string | undefined,
    priority: priority?.name as string | undefined,
    priorityIcon: priority?.iconUrl as string | undefined,
    icon: issuetype?.iconUrl as string | undefined,
    labels: labels?.length ? labels : undefined,
    subtitle: components?.[0]?.name,
    fetchedAt: nowIso(),
  };
}

function mapSlackMessages(data: Record<string, unknown>): LinkStatus | null {
  const messages = data.messages as
    | Array<{
        text?: string;
        user?: string;
        ts?: string;
        reply_count?: number;
        reactions?: Array<{ name: string; count: number }>;
      }>
    | undefined;
  const msg = messages?.[0];
  if (!msg) return null;
  const updatedAt = msg.ts
    ? new Date(parseFloat(msg.ts) * 1000).toISOString()
    : undefined;
  const reactions = msg.reactions?.length ? msg.reactions : undefined;
  return {
    title: (msg.text?.trim() || "(empty message)").slice(0, 240),
    updatedAt,
    commentCount: msg.reply_count,
    reactions,
    fetchedAt: nowIso(),
  };
}

function mapToolResponse(source: ConnectorSource, result: unknown): LinkStatus {
  if (!result || typeof result !== "object") return err("network");

  // MCP responses: { content: [{type: "text", text: "..."}, ...] }
  const r = result as {
    content?: Array<{ type: string; text?: string; data?: unknown }>;
    isError?: boolean;
  };

  if (r.isError) return err("not-found");
  if (!r.content?.length) return err("not-found");

  // Try structured JSON first
  const textContent = r.content.find((c) => c.type === "text")?.text;
  if (textContent) {
    try {
      const data = JSON.parse(textContent) as Record<string, unknown>;

      // Source-specific extractors
      if (source === "linear") {
        const mapped = mapLinear(data);
        if (mapped) return mapped;
      }
      if (source === "notion") {
        const mapped = mapNotion(data);
        if (mapped) return mapped;
      }
      if (source === "jira") {
        const mapped = mapJira(data);
        if (mapped) return mapped;
      }
      if (source === "slack") {
        const mapped = mapSlackMessages(data);
        if (mapped) return mapped;
      }

      // Generic fallback: any title/name/summary field
      const title = data.title ?? data.name ?? data.summary;
      if (title) return { title: String(title), fetchedAt: nowIso() };
    } catch {
      // Not JSON — use short raw text as title
      if (textContent.length < 200) {
        return { title: textContent.trim(), fetchedAt: nowIso() };
      }
    }
  }

  return err("unsupported");
}

/**
 * Hydrate a URL using an MCP server instead of the direct API.
 * Returns err("unsupported") if the server has no matching tool.
 */
export async function hydrateMcp(
  source: ConnectorSource,
  url: string,
  client: McpClient,
): Promise<LinkStatus> {
  const hint = HINTS[source];
  if (!hint) return err("unsupported");

  const id = hint.extractId(url);
  if (!id) return err("unsupported");

  try {
    const tools = await client.listTools();
    const tool = findTool(tools, hint.namePatterns);
    if (!tool) return err("unsupported");

    const result = await client.callTool(tool.name, { [hint.idParam]: id });
    return mapToolResponse(source, result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/401|403|unauthorized|forbidden/i.test(msg)) return err("auth");
    if (/not.found|404/i.test(msg)) return err("not-found");
    return err("network");
  }
}

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
};

function findTool(tools: McpTool[], patterns: string[]): McpTool | undefined {
  const lower = patterns.map((p) => p.toLowerCase());
  return tools.find((t) => lower.some((p) => t.name.toLowerCase().includes(p)));
}

function mapToolResponse(result: unknown): LinkStatus {
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

      // Linear-style: { identifier, title, state, assignee, updatedAt }
      if (
        typeof data.identifier === "string" &&
        typeof data.title === "string"
      ) {
        return {
          title: `${data.identifier} — ${data.title}`,
          status: (data.state as Record<string, unknown>)?.name as
            | string
            | undefined,
          assignee: (data.assignee as Record<string, unknown>)?.name as
            | string
            | undefined,
          updatedAt: data.updatedAt as string | undefined,
          fetchedAt: nowIso(),
        };
      }

      // Notion-style: { object: "page", properties: { title: ... } }
      if (data.object === "page") {
        const titleProp = (
          data.properties as Record<string, unknown> | undefined
        )?.title as Record<string, unknown> | undefined;
        const titleArr = titleProp?.title as
          | Array<{ plain_text?: string }>
          | undefined;
        const title =
          titleArr?.[0]?.plain_text ?? (data.title as string) ?? "Untitled";
        return { title, fetchedAt: nowIso() };
      }

      // Generic: any title/name/summary field
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
    return mapToolResponse(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/401|403|unauthorized|forbidden/i.test(msg)) return err("auth");
    if (/not.found|404/i.test(msg)) return err("not-found");
    return err("network");
  }
}

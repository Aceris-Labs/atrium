import { spawnSync } from "child_process";
import type { ConnectorSource, LinkStatus } from "../../shared/types";
import { err, nowIso } from "../connectors/types";

interface AgentLinkResult {
  title: string;
  status: string | null;
  assignee: string | null;
  updatedAt: string | null;
}

const SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    title: { type: "string" },
    status: { type: ["string", "null"] },
    assignee: { type: ["string", "null"] },
    updatedAt: { type: ["string", "null"] },
  },
  required: ["title", "status", "assignee", "updatedAt"],
});

const PROMPTS: Partial<Record<ConnectorSource, (url: string) => string>> = {
  linear: (url) =>
    `Use the Linear MCP tool to fetch the issue at ${url}. ` +
    `Return the issue title, its current status name, the assignee's name (or null), ` +
    `and the updatedAt ISO timestamp (or null).`,

  notion: (url) =>
    `Use the Notion MCP tool to fetch the page at ${url}. ` +
    `Return the page title. Set status, assignee, and updatedAt to null.`,

  jira: (url) =>
    `Use the Jira MCP tool to fetch the issue at ${url}. ` +
    `Return the issue summary as title, its current status name, the assignee's name (or null), ` +
    `and the updated timestamp as updatedAt (or null).`,

  confluence: (url) =>
    `Use the Confluence MCP tool to fetch the page at ${url}. ` +
    `Return the page title. Set status, assignee, and updatedAt to null.`,

  slack: (url) =>
    `Use the Slack MCP tool to fetch the message at ${url}. ` +
    `Return a short summary of the message as title. Set status, assignee, and updatedAt to null.`,
};

/**
 * Hydrate a URL by spawning the claude CLI and using its cloud MCP servers.
 * Uses --json-schema for structured output so no LLM text parsing is needed.
 */
export function hydrateViaAgent(
  claudePath: string,
  source: ConnectorSource,
  url: string,
): LinkStatus {
  const buildPrompt = PROMPTS[source];
  if (!buildPrompt) return err("unsupported");

  const result = spawnSync(
    claudePath,
    [
      "-p",
      buildPrompt(url),
      "--output-format",
      "json",
      "--json-schema",
      SCHEMA,
    ],
    { encoding: "utf-8", timeout: 30_000 },
  );

  if (result.status !== 0 || !result.stdout) return err("network");

  let envelope: {
    is_error?: boolean;
    structured_output?: AgentLinkResult;
  };
  try {
    envelope = JSON.parse(result.stdout) as typeof envelope;
  } catch {
    return err("network");
  }

  if (envelope.is_error || !envelope.structured_output) return err("network");

  const data = envelope.structured_output;
  return {
    title: data.title,
    status: data.status ?? undefined,
    assignee: data.assignee ?? undefined,
    updatedAt: data.updatedAt ?? undefined,
    fetchedAt: nowIso(),
  };
}

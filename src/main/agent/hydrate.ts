import { spawn } from "child_process";
import type { ConnectorSource, LinkStatus } from "../../shared/types";
import { err, nowIso } from "../connectors/types";

interface AgentLinkResult {
  title: string;
  status: string | null;
  assignee: string | null;
  updatedAt: string | null;
  errorCode: string | null;
}

const SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    title: { type: "string" },
    status: { type: ["string", "null"] },
    assignee: { type: ["string", "null"] },
    updatedAt: { type: ["string", "null"] },
    errorCode: { type: ["string", "null"] },
  },
  required: ["title", "status", "assignee", "updatedAt", "errorCode"],
});

const TOOL_UNAVAILABLE_NOTE =
  `If the required tool is not available or you lack permission to use it, ` +
  `set errorCode to "not-configured" and title to an empty string. ` +
  `Otherwise set errorCode to null.`;

const PROMPTS: Partial<Record<ConnectorSource, (url: string) => string>> = {
  linear: (url) =>
    `Use the Linear MCP tool to fetch the issue at ${url}. ` +
    `Return the issue title, its current status name, the assignee's name (or null), ` +
    `and the updatedAt ISO timestamp (or null). ${TOOL_UNAVAILABLE_NOTE}`,

  notion: (url) =>
    `Use the Notion MCP tool to fetch the page at ${url}. ` +
    `Return the page title. Set status, assignee, and updatedAt to null. ${TOOL_UNAVAILABLE_NOTE}`,

  jira: (url) =>
    `Use the Jira MCP tool to fetch the issue at ${url}. ` +
    `Return the issue summary as title, its current status name, the assignee's name (or null), ` +
    `and the updated timestamp as updatedAt (or null). ${TOOL_UNAVAILABLE_NOTE}`,

  confluence: (url) =>
    `Use the Confluence MCP tool to fetch the page at ${url}. ` +
    `Return the page title. Set status, assignee, and updatedAt to null. ${TOOL_UNAVAILABLE_NOTE}`,

  slack: (url) =>
    `Use the Slack MCP tool to fetch the message at ${url}. ` +
    `Return a short summary of the message as title. Set status, assignee, and updatedAt to null. ${TOOL_UNAVAILABLE_NOTE}`,
};

// Patterns in a returned title that signal the agent couldn't access the tool.
// Used as a fallback in case the model doesn't set errorCode correctly.
const ERROR_TITLE_PATTERNS = [
  "unable to retrieve",
  "permission not granted",
  "tool permission",
  "not available",
  "cannot access",
  "failed to retrieve",
  "tool not found",
  "no tool",
];

/**
 * Hydrate a URL by spawning the claude CLI and using its cloud MCP servers.
 * Uses --json-schema for structured output so no LLM text parsing is needed.
 * Async to avoid blocking the Electron main process.
 */
export function hydrateViaAgent(
  claudePath: string,
  source: ConnectorSource,
  url: string,
): Promise<LinkStatus> {
  const buildPrompt = PROMPTS[source];
  if (!buildPrompt) return Promise.resolve(err("unsupported"));

  return new Promise((resolve) => {
    const proc = spawn(claudePath, [
      "-p",
      buildPrompt(url),
      "--output-format",
      "json",
      "--json-schema",
      SCHEMA,
    ]);

    let stdout = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    const timer = setTimeout(() => {
      proc.kill();
      resolve(err("network"));
    }, 30_000);

    proc.on("close", (code: number | null) => {
      clearTimeout(timer);
      if (code !== 0 || !stdout) {
        resolve(err("network"));
        return;
      }
      let envelope: { is_error?: boolean; structured_output?: AgentLinkResult };
      try {
        envelope = JSON.parse(stdout) as typeof envelope;
      } catch {
        resolve(err("network"));
        return;
      }
      if (envelope.is_error || !envelope.structured_output) {
        resolve(err("network"));
        return;
      }
      const data = envelope.structured_output;

      // Agent explicitly flagged that the tool isn't available/permitted.
      if (data.errorCode === "not-configured") {
        resolve(err("not-configured"));
        return;
      }

      // Fallback: detect error messages that ended up in the title field.
      const titleLower = data.title.toLowerCase();
      if (ERROR_TITLE_PATTERNS.some((p) => titleLower.includes(p))) {
        resolve(err("not-configured"));
        return;
      }

      resolve({
        title: data.title,
        status: data.status ?? undefined,
        assignee: data.assignee ?? undefined,
        updatedAt: data.updatedAt ?? undefined,
        fetchedAt: nowIso(),
      });
    });

    proc.on("error", () => {
      clearTimeout(timer);
      resolve(err("network"));
    });
  });
}

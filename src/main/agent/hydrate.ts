import { spawn } from "child_process";
import type { ConnectorSource, LinkStatus } from "../../shared/types";
import { err, nowIso } from "../connectors/types";

interface AgentLinkResult {
  title: string;
  status: string | null;
  assignee: string | null;
  updatedAt: string | null;
  errorCode: string | null;
  identifier: string | null;
  subtitle: string | null;
  priority: string | null;
  labels: string[] | null;
  authorName: string | null;
  commentCount: number | null;
  description: string | null;
  project: string | null;
  parent: string | null;
  dueDate: string | null;
}

const FIELDS = [
  "title",
  "status",
  "assignee",
  "updatedAt",
  "errorCode",
  "identifier",
  "subtitle",
  "priority",
  "labels",
  "authorName",
  "commentCount",
  "description",
  "project",
  "parent",
  "dueDate",
] as const;

const SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    title: { type: "string" },
    status: { type: ["string", "null"] },
    assignee: { type: ["string", "null"] },
    updatedAt: { type: ["string", "null"] },
    errorCode: { type: ["string", "null"] },
    identifier: { type: ["string", "null"] },
    subtitle: { type: ["string", "null"] },
    priority: { type: ["string", "null"] },
    labels: { type: ["array", "null"], items: { type: "string" } },
    authorName: { type: ["string", "null"] },
    commentCount: { type: ["number", "null"] },
    description: { type: ["string", "null"] },
    project: { type: ["string", "null"] },
    parent: { type: ["string", "null"] },
    dueDate: { type: ["string", "null"] },
  },
  required: [...FIELDS],
});

const TOOL_UNAVAILABLE_NOTE =
  `If the required tool is not available or you lack permission to use it, ` +
  `set errorCode to "not-configured" and title to an empty string. ` +
  `Otherwise set errorCode to null.`;

const PROMPTS: Partial<Record<ConnectorSource, (url: string) => string>> = {
  linear: (url) =>
    `Use the Linear MCP tool to fetch the issue at ${url}. ` +
    `Return these fields: ` +
    `identifier (e.g. "ENG-123"), ` +
    `title (issue title only, no identifier prefix), ` +
    `status (state name), ` +
    `assignee name, ` +
    `updatedAt ISO timestamp, ` +
    `priority label (e.g. "High", "Urgent", or null), ` +
    `labels (array of label names, or null), ` +
    `subtitle (team key, e.g. "ENG"), ` +
    `commentCount (total comment count as number, or null), ` +
    `project (project name if the issue belongs to one, otherwise null), ` +
    `parent (parent issue identifier like "ENG-100" if this is a sub-issue, otherwise null), ` +
    `dueDate (ISO date if set, otherwise null), ` +
    `description (plain-text excerpt of the issue description, max 200 chars, or null). ` +
    `Set authorName to null. ` +
    `${TOOL_UNAVAILABLE_NOTE}`,

  notion: (url) =>
    `Use the Notion MCP tool to fetch the page at ${url}. ` +
    `Return: title (page title including any emoji prefix), ` +
    `subtitle (the "Pod" property value if present, otherwise null), ` +
    `labels (the "Tags" property array if present, otherwise null), ` +
    `updatedAt (the "Created At" date as an ISO string if present, otherwise null), ` +
    `authorName (last_edited_by name if available, otherwise null), ` +
    `project (parent page title if this page is nested under another page, otherwise null), ` +
    `description (plain-text excerpt of the first paragraph, max 200 chars, or null). ` +
    `Set identifier, status, assignee, priority, commentCount, parent, dueDate to null. ` +
    `${TOOL_UNAVAILABLE_NOTE}`,

  jira: (url) =>
    `Use the Jira MCP tool to fetch the issue at ${url}. ` +
    `Return: identifier (issue key, e.g. "ENG-123"), title (summary only), ` +
    `status (status name), assignee displayName, updatedAt timestamp, ` +
    `priority (priority name, or null), subtitle (first component name, or null), ` +
    `labels (array of label strings, or null), ` +
    `project (project name from the "fields.project.name", or null), ` +
    `parent (parent issue key like "ENG-100" if this is a sub-task, otherwise null), ` +
    `dueDate (fields.duedate as ISO, or null), ` +
    `description (plain-text excerpt of the description, max 200 chars, or null). ` +
    `Set commentCount, authorName to null. ` +
    `${TOOL_UNAVAILABLE_NOTE}`,

  confluence: (url) =>
    `Use the Confluence MCP tool to fetch the page at ${url}. ` +
    `Return: title (page title), subtitle (space name, or null), ` +
    `authorName (last editor, or null), ` +
    `updatedAt (last-modified ISO timestamp, or null), ` +
    `project (parent page title if nested, otherwise null), ` +
    `description (plain-text excerpt of the body, max 200 chars, or null). ` +
    `Set identifier, status, assignee, priority, labels, commentCount, parent, dueDate to null. ` +
    `${TOOL_UNAVAILABLE_NOTE}`,

  figma: (url) =>
    `Use the Figma MCP tool to fetch metadata for ${url}. ` +
    `Return: title (file or node name), ` +
    `authorName (last editor display name, or null), ` +
    `updatedAt (last-modified ISO timestamp, or null), ` +
    `subtitle (project or team name, if available, otherwise null), ` +
    `description (a brief description of what the file/frame contains, max 200 chars, or null). ` +
    `Set identifier, status, assignee, priority, labels, commentCount, project, parent, dueDate to null. ` +
    `${TOOL_UNAVAILABLE_NOTE}`,

  coda: (url) =>
    `Use any available Coda MCP tool to fetch the doc/page at ${url}. ` +
    `Return: title (doc or page name), ` +
    `subtitle (workspace/folder name if available, otherwise null), ` +
    `authorName (last editor, or null), ` +
    `updatedAt (last-modified ISO timestamp, or null), ` +
    `description (a brief excerpt of the page content, max 200 chars, or null). ` +
    `Set identifier, status, assignee, priority, labels, commentCount, project, parent, dueDate to null. ` +
    `${TOOL_UNAVAILABLE_NOTE}`,

  github: (url) =>
    `Fetch the GitHub item at ${url} (issue or PR). ` +
    `Return: identifier (e.g. "owner/repo#123"), ` +
    `title, status (state — open/closed/merged), ` +
    `assignee (first assignee login or null), ` +
    `updatedAt (ISO timestamp), ` +
    `authorName (PR/issue author), ` +
    `labels (label names array, or null), ` +
    `commentCount (number, or null), ` +
    `project (repo name without owner, or null), ` +
    `description (body excerpt, max 200 chars, or null). ` +
    `Set subtitle, priority, parent, dueDate to null. ` +
    `${TOOL_UNAVAILABLE_NOTE}`,

  slack: (url) => {
    // Extract channel_id and message_ts from URL: /archives/{channel_id}/p{ts_no_dot}
    const m = url.match(/archives\/([A-Z0-9]+)\/p(\d+)/i);
    const channelId = m?.[1] ?? "";
    const rawTs = m?.[2] ?? "";
    const messageTs =
      rawTs.length > 6 ? `${rawTs.slice(0, -6)}.${rawTs.slice(-6)}` : rawTs;
    return (
      `Use the Slack MCP tools to fetch the message at ${url}. ` +
      `Step 1: call slack_read_thread with channel_id="${channelId}" and message_ts="${messageTs}" to get the message and replies. ` +
      `Step 2: call slack_read_channel with channel_id="${channelId}" to get the channel name. ` +
      `Return: title (parent message text up to 240 chars), ` +
      `subtitle (channel name prefixed with #, from step 2), ` +
      `authorName (the display name from the "From:" field of the parent message — null if empty or a bot), ` +
      `commentCount (number of thread replies, or null). ` +
      `Set identifier, status, assignee, priority, labels to null. ` +
      `${TOOL_UNAVAILABLE_NOTE}`
    );
  },
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
    }, 60_000);

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
        identifier: data.identifier ?? undefined,
        subtitle: data.subtitle ?? undefined,
        priority: data.priority ?? undefined,
        labels: data.labels?.length ? data.labels : undefined,
        authorName: data.authorName ?? undefined,
        commentCount: data.commentCount ?? undefined,
        description: data.description?.trim() || undefined,
        project: data.project ?? undefined,
        parent: data.parent ?? undefined,
        dueDate: data.dueDate ?? undefined,
        fetchedAt: nowIso(),
      });
    });

    proc.on("error", () => {
      clearTimeout(timer);
      resolve(err("network"));
    });
  });
}

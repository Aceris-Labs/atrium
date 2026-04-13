import type { LinearConfig, LinkStatusKind } from "../../shared/types";
import type { Connector } from "./types";
import { err, nowIso } from "./types";

const LINEAR_URL_RE = /linear\.app\/[^/]+\/issue\/([A-Z0-9]+-\d+)/;
const API = "https://api.linear.app/graphql";
const TIMEOUT_MS = 5000;

const ISSUE_QUERY = `
  query($id: String!) {
    issue(id: $id) {
      identifier
      title
      state { name type }
      assignee { name }
      updatedAt
    }
  }
`;

const VIEWER_QUERY = `query { viewer { id name email } }`;

function mapState(type: string | undefined): LinkStatusKind {
  switch (type) {
    case "triage":
    case "backlog":
    case "unstarted":
      return "open";
    case "started":
      return "in-progress";
    case "completed":
    case "canceled":
      return "done";
    default:
      return "unknown";
  }
}

async function gql(
  apiKey: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Linear personal API keys go in the Authorization header without a Bearer prefix.
        Authorization: apiKey,
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export const linearConnector: Connector<LinearConfig> = {
  source: "linear",
  secretFields: ["apiKey"],

  match: (url) => LINEAR_URL_RE.test(url),

  async hydrate(url, config) {
    const match = url.match(LINEAR_URL_RE);
    if (!match) return err("unsupported");
    const issueId = match[1];
    try {
      const res = await gql(config.apiKey, ISSUE_QUERY, { id: issueId });
      if (res.status === 401 || res.status === 403) return err("auth");
      if (res.status === 429) return err("rate-limited");
      if (!res.ok) return err("network");
      const json = (await res.json()) as {
        data?: {
          issue?: {
            identifier: string;
            title: string;
            state?: { name?: string; type?: string };
            assignee?: { name?: string };
            updatedAt?: string;
          };
        };
      };
      const issue = json?.data?.issue;
      if (!issue) return err("not-found");
      return {
        title: `${issue.identifier} — ${issue.title}`,
        status: issue.state?.name,
        statusKind: mapState(issue.state?.type),
        assignee: issue.assignee?.name,
        updatedAt: issue.updatedAt,
        fetchedAt: nowIso(),
      };
    } catch {
      return err("network");
    }
  },

  async test(config) {
    if (!config?.apiKey?.trim()) {
      return { ok: false, error: "API key is empty" };
    }
    try {
      const res = await gql(config.apiKey, VIEWER_QUERY);
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: "Invalid API key" };
      }
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}` };
      }
      const json = (await res.json()) as {
        data?: { viewer?: { id: string; name?: string; email?: string } };
        errors?: Array<{ message: string }>;
      };
      if (json.errors?.length) {
        return { ok: false, error: json.errors[0].message };
      }
      const viewer = json?.data?.viewer;
      if (!viewer) return { ok: false, error: "Unexpected response" };
      return { ok: true, identity: viewer.email ?? viewer.name ?? viewer.id };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error";
      return { ok: false, error: msg };
    }
  },
};

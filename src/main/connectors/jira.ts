import type { JiraConfig, LinkStatusKind } from "../../shared/types";
import {
  atlassianFetch,
  mapAtlassianError,
  normalizeAtlassianDomain,
} from "./atlassian";
import type { Connector } from "./types";
import { err, nowIso } from "./types";

const JIRA_URL_RE =
  /([a-z0-9-]+)\.atlassian\.net\/browse\/([A-Z][A-Z0-9_]*-\d+)/i;

function mapStatusCategory(key: string | undefined): LinkStatusKind {
  switch (key) {
    case "new":
    case "undefined":
      return "open";
    case "indeterminate":
      return "in-progress";
    case "done":
      return "done";
    default:
      return "unknown";
  }
}

interface JiraIssueResponse {
  key: string;
  fields?: {
    summary?: string;
    status?: {
      name?: string;
      statusCategory?: { key?: string };
    };
    assignee?: { displayName?: string };
    updated?: string;
    priority?: { name?: string; iconUrl?: string };
    issuetype?: { name?: string; iconUrl?: string };
    labels?: string[];
    components?: Array<{ name?: string }>;
  };
}

interface JiraMyself {
  emailAddress?: string;
  displayName?: string;
  accountId?: string;
}

export const jiraConnector: Connector<JiraConfig> = {
  source: "jira",
  secretFields: ["apiToken"],

  match: (url) => JIRA_URL_RE.test(url),

  async hydrate(url, config) {
    const match = url.match(JIRA_URL_RE);
    if (!match) return err("unsupported");
    const urlDomain = match[1].toLowerCase();
    const configuredDomain = normalizeAtlassianDomain(config.domain).split(
      ".",
    )[0];
    if (urlDomain !== configuredDomain) return err("unsupported");
    const key = match[2].toUpperCase();
    try {
      const res = await atlassianFetch(
        config,
        `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,status,assignee,updated,priority,issuetype,labels,components`,
      );
      const mapped = mapAtlassianError(res.status);
      if (mapped) return err(mapped);
      if (!res.ok) return err("network");
      const issue = (await res.json()) as JiraIssueResponse;
      const summary = issue.fields?.summary ?? key;
      const labels = issue.fields?.labels?.filter(Boolean);
      return {
        identifier: issue.key,
        title: summary,
        status: issue.fields?.status?.name,
        statusKind: mapStatusCategory(
          issue.fields?.status?.statusCategory?.key,
        ),
        assignee: issue.fields?.assignee?.displayName,
        updatedAt: issue.fields?.updated,
        priority: issue.fields?.priority?.name,
        priorityIcon: issue.fields?.priority?.iconUrl,
        icon: issue.fields?.issuetype?.iconUrl,
        labels: labels?.length ? labels : undefined,
        subtitle: issue.fields?.components?.[0]?.name,
        fetchedAt: nowIso(),
      };
    } catch {
      return err("network");
    }
  },

  async test(config) {
    if (
      !config?.domain?.trim() ||
      !config?.email?.trim() ||
      !config?.apiToken?.trim()
    ) {
      return { ok: false, error: "Missing domain, email, or API token" };
    }
    try {
      const res = await atlassianFetch(config, "/rest/api/3/myself");
      if (res.status === 401)
        return { ok: false, error: "Invalid email or API token" };
      if (res.status === 403) return { ok: false, error: "Access forbidden" };
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const me = (await res.json()) as JiraMyself;
      return {
        ok: true,
        identity: me.emailAddress ?? me.displayName ?? me.accountId,
      };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Network error",
      };
    }
  },
};

import type { ConfluenceConfig, LinkStatusKind } from "../../shared/types";
import {
  atlassianFetch,
  mapAtlassianError,
  normalizeAtlassianDomain,
} from "./atlassian";
import type { Connector } from "./types";
import { err, nowIso } from "./types";

const CONFLUENCE_URL_RE =
  /([a-z0-9-]+)\.atlassian\.net\/wiki\/spaces\/[^/]+\/pages\/(\d+)/i;

function mapPageStatus(status: string | undefined): LinkStatusKind {
  switch (status) {
    case "current":
      return "done";
    case "draft":
      return "in-progress";
    case "archived":
      return "done";
    default:
      return "unknown";
  }
}

interface ConfluencePage {
  id: string;
  title?: string;
  status?: string;
  space?: { name?: string; key?: string };
  version?: {
    number?: number;
    createdAt?: string;
    by?: { displayName?: string };
  };
}

interface ConfluenceUser {
  email?: string;
  displayName?: string;
  publicName?: string;
}

export const confluenceConnector: Connector<ConfluenceConfig> = {
  source: "confluence",
  secretFields: ["apiToken"],

  match: (url) => CONFLUENCE_URL_RE.test(url),

  async hydrate(url, config) {
    const match = url.match(CONFLUENCE_URL_RE);
    if (!match) return err("unsupported");
    const urlDomain = match[1].toLowerCase();
    const configuredDomain = normalizeAtlassianDomain(config.domain).split(
      ".",
    )[0];
    if (urlDomain !== configuredDomain) return err("unsupported");
    const pageId = match[2];
    try {
      const res = await atlassianFetch(
        config,
        `/wiki/rest/api/content/${encodeURIComponent(pageId)}?expand=space,version`,
      );
      const mapped = mapAtlassianError(res.status);
      if (mapped) return err(mapped);
      if (!res.ok) return err("network");
      const page = (await res.json()) as ConfluencePage;
      const versionLabel = page.version?.number
        ? `v${page.version.number}`
        : undefined;
      return {
        title: page.title,
        status: page.status,
        statusKind: mapPageStatus(page.status),
        updatedAt: page.version?.createdAt,
        subtitle: page.space?.name,
        authorName: page.version?.by?.displayName,
        labels: versionLabel ? [versionLabel] : undefined,
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
      const res = await atlassianFetch(config, "/wiki/rest/api/user/current");
      if (res.status === 401)
        return { ok: false, error: "Invalid email or API token" };
      if (res.status === 403) return { ok: false, error: "Access forbidden" };
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const me = (await res.json()) as ConfluenceUser;
      return {
        ok: true,
        identity: me.email ?? me.displayName ?? me.publicName,
      };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Network error",
      };
    }
  },
};

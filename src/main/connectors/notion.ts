import type { NotionConfig } from "../../shared/types";
import type { Connector } from "./types";
import { err, nowIso } from "./types";

// Matches notion.so URLs and extracts the 32-char hex page ID from the end.
// Examples:
//   notion.so/workspace/Page-Title-abc123...  (workspace-scoped)
//   notion.so/abc123...                        (short form)
const NOTION_URL_RE =
  /notion\.so\/(?:[^/?#]+\/)*(?:[^/?#]*-)?([\da-f]{32})(?:[?#]|$)/i;
const API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const TIMEOUT_MS = 5000;

/** Notion page IDs in URLs are 32 hex chars; the API wants UUID format. */
function toUuid(id: string): string {
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

async function notionFetch(token: string, path: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${API}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

interface NotionRichText {
  plain_text: string;
}

interface NotionTitleProperty {
  type: "title";
  title: NotionRichText[];
}

interface NotionPage {
  id: string;
  last_edited_time?: string;
  icon?:
    | { type: "emoji"; emoji: string }
    | { type: "external"; external: { url: string } };
  cover?:
    | { type: "external"; external: { url: string } }
    | { type: "file"; file: { url: string } };
  last_edited_by?: { id: string; name?: string };
  properties?: Record<string, { type: string } & Partial<NotionTitleProperty>>;
}

interface NotionUser {
  id: string;
  name?: string;
  person?: { email?: string };
}

function extractTitle(page: NotionPage): string | undefined {
  if (!page.properties) return undefined;
  for (const prop of Object.values(page.properties)) {
    if (prop.type === "title" && prop.title?.length) {
      return prop.title.map((t) => t.plain_text).join("");
    }
  }
  return undefined;
}

function extractIcon(page: NotionPage): string | undefined {
  if (!page.icon) return undefined;
  if (page.icon.type === "emoji") return page.icon.emoji;
  if (page.icon.type === "external") return page.icon.external.url;
  return undefined;
}

export const notionConnector: Connector<NotionConfig> = {
  source: "notion",
  secretFields: ["apiToken"],

  match: (url) => NOTION_URL_RE.test(url),

  async hydrate(url, config) {
    const match = url.match(NOTION_URL_RE);
    if (!match) return err("unsupported");
    const pageId = toUuid(match[1]);
    try {
      const res = await notionFetch(config.apiToken, `/pages/${pageId}`);
      if (res.status === 401) return err("auth");
      if (res.status === 403) return err("forbidden");
      if (res.status === 404) return err("not-found");
      if (res.status === 429) return err("rate-limited");
      if (!res.ok) return err("network");
      const page = (await res.json()) as NotionPage;
      const coverUrl =
        page.cover?.type === "external"
          ? page.cover.external.url
          : page.cover?.type === "file"
            ? page.cover.file.url
            : undefined;
      return {
        title: extractTitle(page),
        icon: extractIcon(page),
        updatedAt: page.last_edited_time,
        authorName: page.last_edited_by?.name,
        thumbnailUrl: coverUrl,
        fetchedAt: nowIso(),
      };
    } catch {
      return err("network");
    }
  },

  async test(config) {
    if (!config?.apiToken?.trim()) {
      return { ok: false, error: "API token is empty" };
    }
    try {
      const res = await notionFetch(config.apiToken, "/users/me");
      if (res.status === 401) return { ok: false, error: "Invalid API token" };
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const user = (await res.json()) as NotionUser;
      return {
        ok: true,
        identity: user.person?.email ?? user.name ?? user.id,
      };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Network error",
      };
    }
  },
};

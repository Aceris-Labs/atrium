import type { NotionConfig } from "../../../shared/types";
import {
  failed,
  ok,
  type HydratedResource,
  type ObservedResourceResult,
  type ResourceFailure,
  type ResourceProviderClient,
  type ResourceProviderDefinition,
  type ResourceQuery,
  type ResourceRef,
  type Result,
} from "../types";

export type NotionPageKind = "notion.page";

export type NotionPageRef = ResourceRef<"notion", NotionPageKind>;

type NotionPageQueryPayload =
  | { mode: "refs"; refs: NotionPageRef[] }
  | { mode: "search"; query: string; limit: number };

export type NotionPageQuery = ResourceQuery<
  "notion",
  NotionPageKind,
  NotionPageQueryPayload
>;

export interface NotionPagePreview {
  title?: string;
  icon?: string;
  updatedAt?: string;
  authorName?: string;
  thumbnailUrl?: string;
}

export interface NotionPageData extends NotionPagePreview {
  pageId: string;
  url?: string;
}

type NotionPageClient = ResourceProviderClient<
  "notion",
  NotionPageQuery,
  NotionPageRef,
  NotionPagePreview,
  NotionPageData
>;

const API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const TIMEOUT_MS = 5000;
const NOTION_PAGE_ID_RE =
  /(?:^|[-/])([0-9a-f]{32})(?:[?#]|$)|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

interface NotionRichText {
  plain_text: string;
}

interface NotionTitleProperty {
  type: "title";
  title: NotionRichText[];
}

interface NotionPage {
  object: "page";
  id: string;
  url?: string;
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

interface NotionSearchResponse {
  results?: NotionPage[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function compactPageId(id: string): string {
  return id.replace(/-/g, "").toLowerCase();
}

function toUuid(id: string): string | null {
  const compact = compactPageId(id);
  if (!/^[0-9a-f]{32}$/.test(compact)) return null;
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function parsePageId(value: string): string | null {
  const match = value.match(NOTION_PAGE_ID_RE);
  const raw = match?.[1] ?? match?.[2];
  return raw ? toUuid(raw) : null;
}

function fallbackUrl(pageId: string): string {
  return `https://www.notion.so/${compactPageId(pageId)}`;
}

function queryKey(prefix: string, value: unknown): string {
  return `${prefix}:${JSON.stringify(value)}`;
}

function badRefFailure(
  message: string,
  ref?: NotionPageRef,
): ResourceFailure<NotionPageRef> {
  return { code: "bad-query", message, ref };
}

function normalizeNotionPageRef(
  ref: NotionPageRef,
): Result<NotionPageRef, ResourceFailure<NotionPageRef>> {
  const pageId = toUuid(ref.id);
  if (!pageId) {
    return failed(badRefFailure(`Invalid Notion page id: ${ref.id}`, ref));
  }
  return ok({
    source: "notion",
    kind: "notion.page",
    id: pageId,
    url: ref.url ?? fallbackUrl(pageId),
  });
}

function parseNotionPageUrl(
  url: string,
): Result<NotionPageRef, ResourceFailure<NotionPageRef>> {
  const pageId = parsePageId(url);
  if (!pageId) {
    return failed({
      code: "unsupported",
      message: "URL is not a Notion page URL",
    });
  }
  return ok({
    source: "notion",
    kind: "notion.page",
    id: pageId,
    url,
  });
}

function parseConfig(
  config: unknown,
): Result<NotionConfig, ResourceFailure<NotionPageRef>> {
  if (
    typeof config === "object" &&
    config !== null &&
    "apiToken" in config &&
    typeof (config as Record<string, unknown>).apiToken === "string" &&
    (config as Record<string, string>).apiToken.trim()
  ) {
    return ok({ apiToken: (config as Record<string, string>).apiToken });
  }
  return failed({
    code: "not-configured",
    message: "Notion API token is not configured",
  });
}

async function notionFetch(
  config: NotionConfig,
  path: string,
  init?: Omit<RequestInit, "headers" | "signal"> & {
    headers?: Record<string, string>;
  },
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${API}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${config.apiToken}`,
        "Notion-Version": NOTION_VERSION,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
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

function extractCoverUrl(page: NotionPage): string | undefined {
  if (page.cover?.type === "external") return page.cover.external.url;
  if (page.cover?.type === "file") return page.cover.file.url;
  return undefined;
}

function refForPage(page: NotionPage): NotionPageRef {
  const id = toUuid(page.id) ?? page.id;
  return {
    source: "notion",
    kind: "notion.page",
    id,
    url: page.url ?? fallbackUrl(id),
  };
}

function previewForPage(page: NotionPage): NotionPagePreview {
  return {
    title: extractTitle(page),
    icon: extractIcon(page),
    updatedAt: page.last_edited_time,
    authorName: page.last_edited_by?.name,
    thumbnailUrl: extractCoverUrl(page),
  };
}

function signatureForPage(page: NotionPage): string {
  return [page.id, page.last_edited_time ?? ""].join("|");
}

function dataForPage(page: NotionPage): NotionPageData {
  const id = toUuid(page.id) ?? page.id;
  return {
    pageId: id,
    url: page.url ?? fallbackUrl(id),
    ...previewForPage(page),
  };
}

function errorForStatus(
  status: number,
): "auth" | "forbidden" | "not-found" | "rate-limited" | "network" {
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 429) return "rate-limited";
  return "network";
}

async function observeRef(
  config: NotionConfig,
  ref: NotionPageRef,
): Promise<ObservedResourceResult<NotionPageRef, NotionPagePreview>> {
  const normalized = normalizeNotionPageRef(ref);
  if (!normalized.ok) return normalized;
  try {
    const res = await notionFetch(config, `/pages/${normalized.value.id}`);
    if (!res.ok) {
      return failed({
        code: errorForStatus(res.status),
        ref: normalized.value,
      });
    }
    const page = (await res.json()) as NotionPage;
    return ok({
      ref: refForPage(page),
      signature: signatureForPage(page),
      preview: previewForPage(page),
      observedAt: nowIso(),
    });
  } catch (cause) {
    return failed({ code: "network", ref: normalized.value, cause });
  }
}

async function observeSearch(
  config: NotionConfig,
  query: string,
  limit: number,
): Promise<
  Result<
    ObservedResourceResult<NotionPageRef, NotionPagePreview>[],
    ResourceFailure<NotionPageRef>
  >
> {
  try {
    const res = await notionFetch(config, "/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        page_size: limit,
        filter: { property: "object", value: "page" },
      }),
    });
    if (!res.ok) return failed({ code: errorForStatus(res.status) });
    const json = (await res.json()) as NotionSearchResponse;
    return ok(
      (json.results ?? []).map((page) =>
        ok({
          ref: refForPage(page),
          signature: signatureForPage(page),
          preview: previewForPage(page),
          observedAt: nowIso(),
        }),
      ),
    );
  } catch (cause) {
    return failed({ code: "network", cause });
  }
}

function createClient(config: NotionConfig): NotionPageClient {
  return {
    source: "notion",

    async observe(query) {
      switch (query.payload.mode) {
        case "refs":
          return ok(
            await Promise.all(
              query.payload.refs.map((ref) => observeRef(config, ref)),
            ),
          );
        case "search":
          return observeSearch(
            config,
            query.payload.query,
            query.payload.limit,
          );
      }
    },

    async hydrate(ref) {
      const normalized = normalizeNotionPageRef(ref);
      if (!normalized.ok) return normalized;
      try {
        const res = await notionFetch(config, `/pages/${normalized.value.id}`);
        if (!res.ok) {
          return failed({
            code: errorForStatus(res.status),
            ref: normalized.value,
          });
        }
        const page = (await res.json()) as NotionPage;
        return ok({
          ref: refForPage(page),
          data: dataForPage(page),
          signature: signatureForPage(page),
          hydratedAt: nowIso(),
        });
      } catch (cause) {
        return failed({ code: "network", ref: normalized.value, cause });
      }
    },
  };
}

export const notionPages = {
  buildRefsQuery(
    refs: NotionPageRef[],
  ): Result<NotionPageQuery, ResourceFailure<NotionPageRef>> {
    const normalized: NotionPageRef[] = [];
    for (const ref of refs) {
      const result = normalizeNotionPageRef(ref);
      if (!result.ok) return result;
      normalized.push(result.value);
    }
    return ok({
      source: "notion",
      kind: "notion.page",
      key: queryKey(
        "notion.page.refs",
        normalized.map((ref) => ref.id),
      ),
      payload: { mode: "refs", refs: normalized },
    });
  },

  buildUrlsQuery(
    urls: string[],
  ): Result<NotionPageQuery, ResourceFailure<NotionPageRef>> {
    const refs: NotionPageRef[] = [];
    for (const url of urls) {
      const result = parseNotionPageUrl(url);
      if (!result.ok) return result;
      refs.push(result.value);
    }
    return this.buildRefsQuery(refs);
  },

  buildSearchQuery(opts: {
    query: string;
    limit?: number;
  }): Result<NotionPageQuery, ResourceFailure<NotionPageRef>> {
    const query = opts.query.trim();
    if (!query) {
      return failed({
        code: "bad-query",
        message: "Notion search query cannot be empty",
      });
    }
    const limit = opts.limit ?? 25;
    return ok({
      source: "notion",
      kind: "notion.page",
      key: queryKey("notion.page.search", { query, limit }),
      payload: { mode: "search", query, limit },
    });
  },
};

export const notionPageProvider: ResourceProviderDefinition<
  "notion",
  NotionPageQuery,
  NotionPageRef,
  NotionPagePreview,
  NotionPageData,
  NotionConfig
> = {
  source: "notion",

  parseUrl: parseNotionPageUrl,
  normalizeRef: normalizeNotionPageRef,

  configure(config) {
    const parsed = parseConfig(config);
    if (!parsed.ok) return parsed;
    return ok(createClient(parsed.value));
  },
};

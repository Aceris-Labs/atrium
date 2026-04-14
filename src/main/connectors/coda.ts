import type { CodaConfig, LinkStatusError } from "../../shared/types";
import type { Connector } from "./types";
import { err, nowIso } from "./types";

// Coda URLs encode the doc id after `_d` and (optionally) the page id after
// `_su`. Example: coda.io/d/My-Doc_dAbC123/Page-Title_su0
const CODA_URL_RE =
  /coda\.io\/d\/[^/]*?_d([A-Za-z0-9-]+)(?:\/[^/?#]*?_su([A-Za-z0-9_-]+))?/;
const API = "https://coda.io/apis/v1";
const TIMEOUT_MS = 5000;

function mapCodaStatus(status: number): LinkStatusError | null {
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "network";
  return null;
}

async function codaFetch(token: string, path: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${API}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

interface CodaPage {
  name?: string;
  updatedAt?: string;
  browserLink?: string;
}

interface CodaDoc {
  name?: string;
  updatedAt?: string;
  browserLink?: string;
  owner?: string;
}

interface CodaWhoami {
  name?: string;
  loginId?: string;
  type?: string;
}

export const codaConnector: Connector<CodaConfig> = {
  source: "coda",
  secretFields: ["apiToken"],

  match: (url) => CODA_URL_RE.test(url),

  async hydrate(url, config) {
    const match = url.match(CODA_URL_RE);
    if (!match) return err("unsupported");
    const docId = match[1];
    const pageId = match[2];

    try {
      if (pageId) {
        const [pageRes, docRes] = await Promise.all([
          codaFetch(
            config.apiToken,
            `/docs/${encodeURIComponent(docId)}/pages/${encodeURIComponent(pageId)}`,
          ),
          codaFetch(config.apiToken, `/docs/${encodeURIComponent(docId)}`),
        ]);
        const mapped = mapCodaStatus(pageRes.status);
        if (mapped) return err(mapped);
        if (!pageRes.ok) return err("network");
        const page = (await pageRes.json()) as CodaPage;
        const doc = docRes.ok ? ((await docRes.json()) as CodaDoc) : undefined;
        return {
          title: page.name,
          updatedAt: page.updatedAt,
          subtitle: doc?.name,
          authorName: doc?.owner,
          fetchedAt: nowIso(),
        };
      }
      // Doc-level link (no page id in the URL).
      const res = await codaFetch(
        config.apiToken,
        `/docs/${encodeURIComponent(docId)}`,
      );
      const mapped = mapCodaStatus(res.status);
      if (mapped) return err(mapped);
      if (!res.ok) return err("network");
      const doc = (await res.json()) as CodaDoc;
      return {
        title: doc.name,
        updatedAt: doc.updatedAt,
        authorName: doc.owner,
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
      const res = await codaFetch(config.apiToken, "/whoami");
      if (res.status === 401) return { ok: false, error: "Invalid API token" };
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const me = (await res.json()) as CodaWhoami;
      return { ok: true, identity: me.loginId ?? me.name };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Network error",
      };
    }
  },
};

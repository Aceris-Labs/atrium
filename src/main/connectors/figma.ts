import type { FigmaConfig, LinkStatusError } from "../../shared/types";
import type { Connector } from "./types";
import { err, nowIso } from "./types";

const FIGMA_URL_RE = /figma\.com\/(?:file|design|proto|board)\/([A-Za-z0-9]+)/;
const API = "https://api.figma.com/v1";
const TIMEOUT_MS = 5000;

function mapFigmaStatus(status: number): LinkStatusError | null {
  // Figma returns 403 for both missing token and wrong token.
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not-found";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "network";
  return null;
}

async function figmaFetch(token: string, path: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${API}${path}`, {
      headers: {
        "X-Figma-Token": token,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

interface FigmaFile {
  name?: string;
  lastModified?: string;
  thumbnailUrl?: string;
}

interface FigmaMe {
  handle?: string;
  email?: string;
  id?: string;
}

export const figmaConnector: Connector<FigmaConfig> = {
  source: "figma",
  secretFields: ["personalAccessToken"],

  match: (url) => FIGMA_URL_RE.test(url),

  async hydrate(url, config) {
    const match = url.match(FIGMA_URL_RE);
    if (!match) return err("unsupported");
    const fileKey = match[1];
    try {
      const res = await figmaFetch(
        config.personalAccessToken,
        `/files/${encodeURIComponent(fileKey)}?depth=1`,
      );
      const mapped = mapFigmaStatus(res.status);
      if (mapped) return err(mapped);
      if (!res.ok) return err("network");
      const file = (await res.json()) as FigmaFile;
      return {
        title: file.name,
        icon: file.thumbnailUrl,
        updatedAt: file.lastModified,
        fetchedAt: nowIso(),
      };
    } catch {
      return err("network");
    }
  },

  async test(config) {
    if (!config?.personalAccessToken?.trim()) {
      return { ok: false, error: "Access token is empty" };
    }
    try {
      const res = await figmaFetch(config.personalAccessToken, "/me");
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: "Invalid access token" };
      }
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const me = (await res.json()) as FigmaMe;
      return { ok: true, identity: me.email ?? me.handle ?? me.id };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Network error",
      };
    }
  },
};

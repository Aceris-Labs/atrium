import { TTLRefresher } from "../refresher";
import { cacheStore } from "../store";
import { listWorkspaces } from "../../store";
import { getCached, isFresh, setCached } from "../../linkCache";
import { hydrateOne } from "../../connectors/registry";
import type { LinkStatus } from "../../../shared/types";

const LINKS_TTL_MS = 5 * 60_000;

/** Hydrates the union of every URL referenced by any workspace.links entry in
 *  the active wing. Deduped across workspaces — a URL linked from three spaces
 *  is fetched once. The on-disk linkCache survives restarts; in-memory state
 *  also lives in the renderer-mirrored cache. */
export class LinksRefresher extends TTLRefresher {
  constructor(private wingId: string) {
    super(LINKS_TTL_MS);
  }

  protected async tick(): Promise<void> {
    const urls = collectUrls(this.wingId);
    if (urls.size === 0) return;

    // Seed the cache from disk for any URLs we haven't pushed yet — avoids a
    // blank-card flash on first paint.
    for (const url of urls) {
      const cached = getCached(url);
      if (cached) cacheStore.setLink(url, cached);
    }

    const stale: string[] = [];
    for (const url of urls) {
      if (!isFresh(getCached(url))) stale.push(url);
    }
    if (stale.length === 0) return;

    const settled = await Promise.allSettled(
      stale.map(async (url) => [url, await hydrateOne(url)] as const),
    );
    for (const s of settled) {
      if (s.status !== "fulfilled") continue;
      const [url, status] = s.value;
      setCached(url, status);
      cacheStore.setLink(url, status);
    }
  }

  /** Refresh a single URL on demand (manual refresh button). */
  async refreshOne(url: string): Promise<LinkStatus | null> {
    try {
      const status = await hydrateOne(url);
      setCached(url, status);
      cacheStore.setLink(url, status);
      return status;
    } catch (err) {
      console.error(`[LinksRefresher] refreshOne(${url}) failed:`, err);
      return null;
    }
  }
}

function collectUrls(wingId: string): Set<string> {
  const urls = new Set<string>();
  for (const ws of listWorkspaces(wingId)) {
    for (const link of ws.links ?? []) urls.add(link.url);
  }
  return urls;
}

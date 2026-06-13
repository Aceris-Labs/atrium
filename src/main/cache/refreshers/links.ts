import type { Refresher } from "../refresher";
import { cacheStore } from "../store";
import { listWorkspaces } from "../../store";
import { getCached, setCached } from "../../linkCache";
import { hydrateOne } from "../../connectors/registry";
import type { LinkStatus } from "../../../shared/types";

/** Hydrates the union of every URL referenced by any workspace.links entry in
 *  the active wing. Deduped across workspaces — a URL linked from three spaces
 *  is fetched once. The on-disk linkCache survives restarts; in-memory state
 *  also lives in the renderer-mirrored cache. Link hydration is direct only:
 *  API/OAuth/CLI connectors, never MCP or Claude. */
export class LinksRefresher implements Refresher {
  private inFlight = false;
  private stopped = false;

  constructor(private wingId: string) {}

  start(): void {
    void this.refresh();
  }

  stop(): void {
    this.stopped = true;
  }

  async refresh(): Promise<void> {
    if (this.inFlight || this.stopped) return;
    this.inFlight = true;
    try {
      await this.hydrateMissing();
    } catch (err) {
      console.error(`[LinksRefresher] refresh failed:`, err);
    } finally {
      this.inFlight = false;
    }
  }

  private async hydrateMissing(): Promise<void> {
    const urls = collectUrls(this.wingId);
    if (urls.size === 0) return;

    // Seed the cache from disk for any URLs we haven't pushed yet — avoids a
    // blank-card flash on first paint.
    for (const url of urls) {
      const cached = getCached(url);
      if (cached) cacheStore.setLink(url, cached);
    }

    const missing: string[] = [];
    for (const url of urls) {
      if (!getCached(url)) missing.push(url);
    }
    if (missing.length === 0) return;

    const settled = await Promise.allSettled(
      missing.map(async (url) => [url, await hydrateOne(url)] as const),
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

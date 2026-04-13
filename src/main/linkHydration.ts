import { hydrateOne } from "./connectors/registry";
import { getCached, isFresh, setCached } from "./linkCache";
import type { LinkStatus } from "../shared/types";

export async function hydrateLinks(
  urls: string[],
): Promise<Record<string, LinkStatus>> {
  const result: Record<string, LinkStatus> = {};
  const toFetch: string[] = [];

  for (const url of urls) {
    const cached = getCached(url);
    if (isFresh(cached)) {
      result[url] = cached!;
    } else {
      toFetch.push(url);
    }
  }

  const settled = await Promise.allSettled(
    toFetch.map(async (url) => [url, await hydrateOne(url)] as const),
  );

  for (const s of settled) {
    if (s.status === "fulfilled") {
      const [url, status] = s.value;
      result[url] = status;
      setCached(url, status);
    }
  }

  return result;
}

export async function refreshLink(url: string): Promise<LinkStatus> {
  const status = await hydrateOne(url);
  setCached(url, status);
  return status;
}

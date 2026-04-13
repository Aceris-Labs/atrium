import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { LinkStatus } from "../shared/types";

const DIR = join(homedir(), ".atrium");
const CACHE_FILE = join(DIR, "link-cache.json");
const TTL_MS = 5 * 60 * 1000;

let cache: Record<string, LinkStatus> = load();

function load(): Record<string, LinkStatus> {
  if (!existsSync(CACHE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function persist(): void {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

export function getCached(url: string): LinkStatus | undefined {
  return cache[url];
}

export function isFresh(status: LinkStatus | undefined): boolean {
  if (!status) return false;
  const age = Date.now() - new Date(status.fetchedAt).getTime();
  return age < TTL_MS;
}

// Only persist outcomes that are stable. Transient errors
// (network, rate-limited) should refetch next visit.
export function setCached(url: string, status: LinkStatus): void {
  if (status.error === "network" || status.error === "rate-limited") return;
  cache[url] = status;
  persist();
}

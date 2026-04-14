import { existsSync, readFileSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import type { LinkStatus } from "../shared/types";

const DIR = join(homedir(), ".atrium");
const CACHE_FILE = join(DIR, "link-cache.json");
const TTL_MS = 5 * 60 * 1000;

// Load once at startup synchronously — acceptable for a one-time cold read.
let cache: Record<string, LinkStatus> = load();

function load(): Record<string, LinkStatus> {
  if (!existsSync(CACHE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

// Debounced async persist: bursts of setCached calls during Promise.allSettled
// unwinding coalesce into a single write rather than N sequential sync writes.
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    mkdir(DIR, { recursive: true })
      .then(() => writeFile(CACHE_FILE, JSON.stringify(cache, null, 2)))
      .catch(() => {}); // best-effort — don't crash if disk write fails
  }, 200);
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
  schedulePersist();
}

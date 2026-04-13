import type { AtlassianConfig, LinkStatusError } from "../../shared/types";

export const ATLASSIAN_TIMEOUT_MS = 5000;

// Normalize a user-entered domain into a clean hostname.
//   "https://foo.atlassian.net/"  → "foo.atlassian.net"
//   "foo"                          → "foo.atlassian.net"
//   "foo.atlassian.net"            → "foo.atlassian.net"
export function normalizeAtlassianDomain(domain: string): string {
  let d = domain
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  if (!d.includes(".")) d = `${d}.atlassian.net`;
  return d.toLowerCase();
}

export function basicAuthHeader(email: string, apiToken: string): string {
  const encoded = Buffer.from(`${email}:${apiToken}`).toString("base64");
  return `Basic ${encoded}`;
}

export async function atlassianFetch(
  config: AtlassianConfig,
  path: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ATLASSIAN_TIMEOUT_MS);
  try {
    const domain = normalizeAtlassianDomain(config.domain);
    return await fetch(`https://${domain}${path}`, {
      headers: {
        Authorization: basicAuthHeader(config.email, config.apiToken),
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export function mapAtlassianError(status: number): LinkStatusError | null {
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "network";
  return null;
}

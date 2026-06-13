import { spawnSync, execFileSync } from "child_process";
import { existsSync } from "fs";
import { getSecret } from "../secrets";
import type {
  ConnectorSource,
  ConnectorStrategy,
  StrategyStatus,
} from "../../shared/types";

/** Which strategies each connector supports, in priority order */
export const SUPPORTED_STRATEGIES: Record<
  ConnectorSource,
  ConnectorStrategy[]
> = {
  linear: ["api-key", "oauth"],
  notion: ["api-key"],
  jira: ["api-key"],
  confluence: ["api-key"],
  slack: ["api-key"],
  discord: ["api-key"],
  coda: ["api-key"],
  figma: ["api-key"],
  github: ["gh-cli"],
};

// Cache results for the app lifetime — binaries won't move during a session.
let _ghPath: string | undefined | null = null;

/** Find the gh CLI binary, checking well-known locations then the login shell. */
export function findGhPath(): string | undefined {
  if (_ghPath !== null) return _ghPath;

  const candidates = [
    "/opt/homebrew/bin/gh",
    "/usr/local/bin/gh",
    "/usr/bin/gh",
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      _ghPath = p;
      return _ghPath;
    }
  }

  try {
    const shell = process.env.SHELL ?? "/bin/zsh";
    const out = execFileSync(shell, ["-l", "-c", "which gh"], {
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
    if (out) {
      _ghPath = out;
      return _ghPath;
    }
  } catch {
    // fall through
  }

  const result = spawnSync("which", ["gh"], { encoding: "utf-8" });
  _ghPath =
    result.status === 0 && result.stdout.trim()
      ? result.stdout.trim()
      : undefined;
  return _ghPath;
}

function secretKey(source: ConnectorSource): string {
  return `connector:${source}`;
}

function isOAuthConfig(raw: unknown): boolean {
  return (
    typeof raw === "object" &&
    raw !== null &&
    "oauthToken" in raw &&
    typeof (raw as Record<string, unknown>).oauthToken === "string"
  );
}

/**
 * Probe all supported direct strategies for a connector and return their status.
 * Call only when the user opens a connector row.
 */
export async function detectStrategies(
  source: ConnectorSource,
): Promise<StrategyStatus[]> {
  const supported = SUPPORTED_STRATEGIES[source];
  const results: StrategyStatus[] = [];

  for (const strategy of supported) {
    if (strategy === "api-key") {
      const stored = getSecret(secretKey(source));
      results.push({
        strategy: "api-key",
        available: true,
        configured: stored !== undefined && !isOAuthConfig(stored),
      });
      continue;
    }

    if (strategy === "oauth") {
      const stored = getSecret(secretKey(source));
      results.push({
        strategy: "oauth",
        available: true,
        configured: isOAuthConfig(stored),
      });
      continue;
    }

    if (strategy === "gh-cli") {
      const ghPath = findGhPath();
      if (!ghPath) {
        results.push({
          strategy: "gh-cli",
          available: false,
          configured: false,
        });
        continue;
      }
      const auth = spawnSync(ghPath, ["auth", "status"], { encoding: "utf-8" });
      const authenticated = auth.status === 0;
      const text = auth.stdout + auth.stderr;
      const match = text.match(/account\s+(\S+)/i);
      const username = match?.[1];
      results.push({
        strategy: "gh-cli",
        available: true,
        configured: authenticated,
        detail: authenticated
          ? username
            ? `as ${username}`
            : undefined
          : "run: gh auth login",
      });
      continue;
    }
  }

  return results;
}

/**
 * Determine the active strategy synchronously — used for the connector list
 * badge without probing external connections.
 */
export function resolveActiveStrategy(
  source: ConnectorSource,
): ConnectorStrategy | null {
  const supported = SUPPORTED_STRATEGIES[source];

  const stored = getSecret(secretKey(source));
  if (stored) {
    if (supported.includes("oauth") && isOAuthConfig(stored)) return "oauth";
    if (supported.includes("api-key")) return "api-key";
  }

  if (supported.includes("gh-cli") && findGhPath()) return "gh-cli";
  return null;
}

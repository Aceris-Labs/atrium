import { spawnSync, execFileSync } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { getSecret } from "../secrets";
import { discoverMcpServers } from "../mcp/discovery";
import { getMcpClient } from "../mcp/client";
import { hydrateMcp } from "../mcp/hydrate";
import { hydrateViaAgent } from "../agent/hydrate";
import type {
  ConnectorSource,
  ConnectorStrategy,
  LinkStatus,
  StrategyStatus,
} from "../../shared/types";

/** Which strategies each connector supports, in priority order */
export const SUPPORTED_STRATEGIES: Record<
  ConnectorSource,
  ConnectorStrategy[]
> = {
  // cloud-mcp before api-key: prefer Claude Code cloud MCPs over manual credentials
  linear: ["mcp", "cloud-mcp", "api-key", "oauth"],
  notion: ["mcp", "cloud-mcp", "api-key"],
  jira: ["mcp", "api-key"],
  confluence: ["mcp", "api-key"],
  slack: ["mcp", "cloud-mcp", "api-key"],
  discord: ["api-key"],
  coda: ["api-key"],
  figma: ["api-key"],
};

// Cache the result for the app lifetime — the claude binary won't move during a session.
let _claudePath: string | undefined | null = null;

/**
 * Find the claude CLI binary. Electron GUI apps don't inherit the user's full
 * shell PATH (e.g. ~/.local/bin is not in /etc/paths), so we can't rely on
 * `which claude` alone. Check well-known install locations first, then fall
 * back to asking the user's login shell.
 */
function findClaudePath(): string | undefined {
  if (_claudePath !== null) return _claudePath;

  // 1. Well-known install locations (works in packaged Electron with no shell PATH)
  const candidates = [
    join(homedir(), ".local", "bin", "claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
    "/usr/bin/claude",
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      _claudePath = p;
      return _claudePath;
    }
  }

  // 2. Ask the login shell (handles nvm, asdf, pyenv, and other PATH managers)
  try {
    const shell = process.env.SHELL ?? "/bin/zsh";
    const out = execFileSync(shell, ["-l", "-c", "which claude"], {
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
    if (out) {
      _claudePath = out;
      return _claudePath;
    }
  } catch {
    // shell not found or which failed — fall through
  }

  // 3. Standard which (in case Electron's PATH has it)
  const result = spawnSync("which", ["claude"], { encoding: "utf-8" });
  _claudePath =
    result.status === 0 && result.stdout.trim()
      ? result.stdout.trim()
      : undefined;
  return _claudePath;
}

function secretKey(source: ConnectorSource): string {
  return `connector:${source}`;
}

/** Separate key so cloud-mcp enablement doesn't conflict with api-key/oauth credentials */
export function cloudMcpKey(source: ConnectorSource): string {
  return `cloudmcp:${source}`;
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
 * Probe all supported strategies for a connector and return their status.
 * This may be slow (attempts MCP connection) — call only when the user opens
 * a connector row.
 */
export async function detectStrategies(
  source: ConnectorSource,
): Promise<StrategyStatus[]> {
  const supported = SUPPORTED_STRATEGIES[source];
  const mcpServers = discoverMcpServers();
  const results: StrategyStatus[] = [];

  for (const strategy of supported) {
    if (strategy === "mcp") {
      const serverConfig = mcpServers.get(source);
      if (!serverConfig) {
        results.push({ strategy: "mcp", available: false, configured: false });
        continue;
      }
      try {
        const client = getMcpClient(serverConfig);
        const tools = await Promise.race([
          client.listTools(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), 5000),
          ),
        ]);
        results.push({
          strategy: "mcp",
          available: true,
          configured: tools.length > 0,
          detail: `via ${serverConfig.name}`,
        });
      } catch {
        results.push({
          strategy: "mcp",
          available: true,
          configured: false,
          detail: `${serverConfig.name} — connection failed`,
        });
      }
      continue;
    }

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

    if (strategy === "cloud-mcp") {
      const claudePath = findClaudePath();
      const enabled =
        claudePath !== undefined &&
        getSecret(cloudMcpKey(source)) !== undefined;
      results.push({
        strategy: "cloud-mcp",
        available: claudePath !== undefined,
        configured: enabled,
        detail: enabled ? "via Claude Code cloud MCP" : undefined,
      });
      continue;
    }

    if (strategy === "agent") {
      const claudePath = findClaudePath();
      results.push({
        strategy: "agent",
        available: claudePath !== undefined,
        configured: claudePath !== undefined,
        detail: claudePath ? "via Claude Code" : undefined,
      });
      continue;
    }
  }

  return results;
}

/**
 * Determine the active strategy synchronously — used for the connector list
 * badge without probing MCP connections.
 *
 * Pass a pre-computed `knownServers` map to avoid redundant file reads when
 * calling for multiple sources in a loop.
 */
export function resolveActiveStrategy(
  source: ConnectorSource,
  knownServers?: Map<ConnectorSource, unknown>,
): ConnectorStrategy | null {
  const supported = SUPPORTED_STRATEGIES[source];
  const mcpServers = knownServers ?? discoverMcpServers();

  if (supported.includes("mcp") && mcpServers.has(source)) return "mcp";

  if (
    supported.includes("cloud-mcp") &&
    findClaudePath() &&
    getSecret(cloudMcpKey(source)) !== undefined
  )
    return "cloud-mcp";

  const stored = getSecret(secretKey(source));
  if (stored) {
    if (supported.includes("oauth") && isOAuthConfig(stored)) return "oauth";
    if (supported.includes("api-key")) return "api-key";
  }

  if (supported.includes("agent") && findClaudePath()) return "agent";
  return null;
}

/**
 * Attempt to hydrate a URL using a non-API strategy (MCP or agent).
 * Returns null if neither is the active strategy — signals caller to fall
 * through to the direct-API connector.
 */
export async function hydrateViaStrategy(
  source: ConnectorSource,
  url: string,
): Promise<LinkStatus | null> {
  const servers = discoverMcpServers();
  const active = resolveActiveStrategy(source, servers);

  if (active === "mcp") {
    const serverConfig = servers.get(source);
    if (!serverConfig) return null;
    return hydrateMcp(source, url, getMcpClient(serverConfig));
  }

  if (active === "cloud-mcp" || active === "agent") {
    const claudePath = findClaudePath();
    if (!claudePath) return null;
    return hydrateViaAgent(claudePath, source, url);
  }

  return null;
}

import { getSecret } from "../secrets";
import { discoverMcpServers } from "../mcp/discovery";
import { getMcpClient } from "../mcp/client";
import { hydrateMcp } from "../mcp/hydrate";
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
  linear: ["mcp", "api-key", "oauth"],
  notion: ["mcp", "api-key"],
  jira: ["mcp", "api-key"],
  confluence: ["mcp", "api-key"],
  slack: ["mcp", "api-key"],
  coda: ["api-key"],
  figma: ["api-key"],
};

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

  const stored = getSecret(secretKey(source));
  if (!stored) return null;
  if (supported.includes("oauth") && isOAuthConfig(stored)) return "oauth";
  if (supported.includes("api-key")) return "api-key";
  return null;
}

/**
 * Attempt to hydrate a URL using the MCP strategy.
 * Returns null if MCP is not the active strategy — signals caller to use the
 * existing direct-API connector instead.
 */
export async function hydrateViaMcp(
  source: ConnectorSource,
  url: string,
): Promise<LinkStatus | null> {
  const servers = discoverMcpServers();
  if (resolveActiveStrategy(source, servers) !== "mcp") return null;

  const serverConfig = servers.get(source);
  if (!serverConfig) return null;

  const client = getMcpClient(serverConfig);
  return hydrateMcp(source, url, client);
}

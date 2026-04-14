import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { ConnectorSource } from "../../shared/types";

export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

// Keywords used to match MCP server names/args to connector sources
const SOURCE_KEYWORDS: Partial<Record<ConnectorSource, string[]>> = {
  linear: ["linear"],
  notion: ["notion"],
  jira: ["jira"],
  confluence: ["confluence"],
  slack: ["slack"],
};

interface RawMcpServerEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  type?: string;
}

function parseSettings(filePath: string): Record<string, unknown> {
  try {
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function matchSource(name: string, args: string[]): ConnectorSource | null {
  const searchIn = [name, ...args].join(" ").toLowerCase();
  for (const [source, keywords] of Object.entries(SOURCE_KEYWORDS)) {
    if (keywords?.some((kw) => searchIn.includes(kw))) {
      return source as ConnectorSource;
    }
  }
  return null;
}

function extractServers(
  settings: Record<string, unknown>,
): Map<ConnectorSource, McpServerConfig> {
  const result = new Map<ConnectorSource, McpServerConfig>();
  const mcpServers = settings.mcpServers as
    | Record<string, RawMcpServerEntry>
    | undefined;
  if (!mcpServers) return result;

  for (const [name, config] of Object.entries(mcpServers)) {
    if (!config?.command) continue;
    const source = matchSource(name, config.args ?? []);
    if (source && !result.has(source)) {
      result.set(source, {
        name,
        command: config.command,
        args: config.args ?? [],
        env: config.env,
      });
    }
  }
  return result;
}

let _mcpCache: Map<ConnectorSource, McpServerConfig> | null = null;
let _mcpCacheAt = 0;
const MCP_CACHE_TTL = 30_000;

/**
 * Reads Claude Code's settings files and returns a map of connector sources
 * to their configured MCP server entries.
 *
 * Checks (in order, first match wins per source):
 *   1. ~/.claude/settings.json — global user settings (mcpServers key)
 *   2. ~/.mcp.json — user-level MCP config (newer Claude Code format)
 *
 * Results are cached for 30 seconds to avoid redundant file reads.
 *
 * Note: claude.ai cloud-managed MCPs (shown in Claude Code's /mcp list as
 * "claude.ai *") are NOT local processes and cannot be discovered here —
 * they run in Anthropic's infrastructure.
 */
export function discoverMcpServers(): Map<ConnectorSource, McpServerConfig> {
  if (_mcpCache && Date.now() - _mcpCacheAt < MCP_CACHE_TTL) return _mcpCache;

  const home = homedir();
  const filePaths = [
    join(home, ".claude", "settings.json"),
    join(home, ".mcp.json"),
  ];

  const result = new Map<ConnectorSource, McpServerConfig>();
  for (const filePath of filePaths) {
    for (const [source, config] of extractServers(parseSettings(filePath))) {
      if (!result.has(source)) result.set(source, config);
    }
  }

  _mcpCache = result;
  _mcpCacheAt = Date.now();
  return result;
}

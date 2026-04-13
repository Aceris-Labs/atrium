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

/**
 * Reads Claude Code's settings files and returns a map of connector sources
 * to their configured MCP server entries.
 *
 * Checks global settings (~/.claude/settings.json) only — project-level
 * settings are workspace-specific and not relevant here.
 */
export function discoverMcpServers(): Map<ConnectorSource, McpServerConfig> {
  const globalPath = join(homedir(), ".claude", "settings.json");
  const settings = parseSettings(globalPath);
  return extractServers(settings);
}

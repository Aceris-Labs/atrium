import { deleteSecret, getSecret, setSecret } from "../secrets";
import { discoverMcpServers } from "../mcp/discovery";
import { codaConnector } from "./coda";
import { confluenceConnector } from "./confluence";
import { figmaConnector } from "./figma";
import { jiraConnector } from "./jira";
import { linearConnector } from "./linear";
import { notionConnector } from "./notion";
import { slackConnector } from "./slack";
import {
  detectStrategies,
  resolveActiveStrategy,
  hydrateViaStrategy,
  SUPPORTED_STRATEGIES,
} from "./strategy";
import { err } from "./types";
import type { Connector } from "./types";
import type {
  ConnectorSource,
  ConnectorStatus,
  ConnectorTestResult,
  LinkStatus,
  StrategyStatus,
} from "../../shared/types";

const CONNECTORS: Connector[] = [
  linearConnector,
  notionConnector,
  jiraConnector,
  confluenceConnector,
  slackConnector,
  codaConnector,
  figmaConnector,
];

function secretKey(source: ConnectorSource): string {
  return `connector:${source}`;
}

function maskValue(value: string): string {
  const tail = value.slice(-4);
  return `••••••••${tail}`;
}

// Given a stored config object and the connector's declared secret fields,
// return the first non-empty secret field as a masked string.
function pickMaskedKey(
  raw: unknown,
  secretFields: readonly string[],
): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  for (const field of secretFields) {
    const v = obj[field];
    if (typeof v === "string" && v.length > 0) return maskValue(v);
  }
  return undefined;
}

// Strip secret fields from the stored config so the renderer can seed form
// state with public values (domain, email…) without secrets crossing IPC.
function pickPublicFields(
  raw: unknown,
  secretFields: readonly string[],
): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const secrets = new Set(secretFields);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (secrets.has(k)) continue;
    if (typeof v === "string" && v.length > 0) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function resolveConnector(url: string): Connector | undefined {
  return CONNECTORS.find((c) => c.match(url));
}

export function listConnectors(): ConnectorStatus[] {
  const mcpServers = discoverMcpServers();
  return CONNECTORS.map((c) => {
    const raw = getSecret(secretKey(c.source));
    const hasMcp =
      mcpServers.has(c.source) &&
      SUPPORTED_STRATEGIES[c.source].includes("mcp");
    const activeStrategy =
      resolveActiveStrategy(c.source, mcpServers) ?? undefined;
    return {
      source: c.source,
      configured: raw !== undefined || hasMcp,
      activeStrategy,
      maskedKey: pickMaskedKey(raw, c.secretFields),
      publicFields: pickPublicFields(raw, c.secretFields),
    };
  });
}

export function listConnectorStrategies(
  source: ConnectorSource,
): Promise<StrategyStatus[]> {
  return detectStrategies(source);
}

export async function hydrateOne(url: string): Promise<LinkStatus> {
  const connector = resolveConnector(url);
  if (!connector) return err("unsupported");

  // Try MCP/agent strategy first — returns null if neither is active
  const strategyResult = await hydrateViaStrategy(connector.source, url);
  if (strategyResult !== null) return strategyResult;

  // Fall back to direct API connector
  const config = getSecret(secretKey(connector.source));
  if (!config) return err("not-configured");
  return connector.hydrate(url, config);
}

export async function testConnector(
  source: ConnectorSource,
  configOverride?: unknown,
): Promise<ConnectorTestResult> {
  const connector = CONNECTORS.find((c) => c.source === source);
  if (!connector) return { ok: false, error: "Unknown connector" };
  const cfg = configOverride ?? getSecret(secretKey(source));
  if (!cfg) return { ok: false, error: "Not configured" };
  return connector.test(cfg);
}

export function setConnectorConfig(
  source: ConnectorSource,
  config: unknown,
): void {
  setSecret(secretKey(source), config);
}

export function removeConnectorConfig(source: ConnectorSource): void {
  deleteSecret(secretKey(source));
}

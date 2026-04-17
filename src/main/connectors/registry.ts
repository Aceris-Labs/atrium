import { deleteSecret, getSecret, setSecret } from "../secrets";
import { discoverMcpServers } from "../mcp/discovery";
import { codaConnector } from "./coda";
import { confluenceConnector } from "./confluence";
import { figmaConnector } from "./figma";
import { githubConnector } from "./github";
import { claudeConnector } from "./claude";
import { jiraConnector } from "./jira";
import { linearConnector } from "./linear";
import { notionConnector } from "./notion";
import { slackConnector } from "./slack";
import { discordConnector } from "./discord";
import {
  detectStrategies,
  resolveActiveStrategy,
  hydrateViaStrategy,
  SUPPORTED_STRATEGIES,
  cloudMcpKey,
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
  discordConnector,
  codaConnector,
  figmaConnector,
  githubConnector,
  claudeConnector,
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
    const hasCloudMcp =
      getSecret(cloudMcpKey(c.source)) !== undefined &&
      SUPPORTED_STRATEGIES[c.source].includes("cloud-mcp");
    const activeStrategy =
      resolveActiveStrategy(c.source, mcpServers) ?? undefined;
    // CLI-backed connectors override configured status via checkConfigured()
    const configured =
      c.checkConfigured?.() ?? (raw !== undefined || hasMcp || hasCloudMcp);
    return {
      source: c.source,
      configured,
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

  // For secretless connectors (CLI-backed) pass an empty config object
  const config =
    getSecret(secretKey(connector.source)) ??
    (connector.secretFields.length === 0 ? {} : undefined);
  if (!config) return err("not-configured");
  return connector.hydrate(url, config);
}

export async function testConnector(
  source: ConnectorSource,
  configOverride?: unknown,
): Promise<ConnectorTestResult> {
  const connector = CONNECTORS.find((c) => c.source === source);
  if (!connector) return { ok: false, error: "Unknown connector" };
  // Secretless connectors (CLI-backed) use an empty config object
  const cfg =
    configOverride ??
    getSecret(secretKey(source)) ??
    (connector.secretFields.length === 0 ? {} : undefined);
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

export function enableCloudMcp(source: ConnectorSource): void {
  setSecret(cloudMcpKey(source), { enabled: true });
}

export function disableCloudMcp(source: ConnectorSource): void {
  deleteSecret(cloudMcpKey(source));
}

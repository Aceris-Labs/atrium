import type {
  ConnectorSource,
  ConnectorTestResult,
  LinkStatus,
  LinkStatusError,
} from "../../shared/types";

export interface Connector<Config = unknown> {
  source: ConnectorSource;
  secretFields: readonly string[];
  match(url: string): boolean;
  hydrate(url: string, config: Config): Promise<LinkStatus>;
  test(config: Config): Promise<ConnectorTestResult>;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function err(kind: LinkStatusError): LinkStatus {
  return { error: kind, fetchedAt: nowIso() };
}

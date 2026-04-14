import { useEffect, useState } from "react";
import type {
  ConnectorSource,
  ConnectorStatus,
  ConnectorStrategy,
  ConnectorTestResult,
  StrategyStatus,
} from "../../../shared/types";

interface ConnectorField {
  name: string;
  label: string;
  type: "text" | "password";
  placeholder?: string;
}

interface ConnectorMeta {
  source: ConnectorSource;
  name: string;
  createUrl?: string;
  createLabel?: string;
  fields: ConnectorField[];
  helpText?: string;
  oauth?: boolean;
}

const CONNECTORS: ConnectorMeta[] = [
  {
    source: "linear",
    name: "Linear",
    fields: [],
    oauth: true,
  },
  {
    source: "notion",
    name: "Notion",
    createUrl: "https://www.notion.so/my-integrations",
    createLabel: "Create a Notion integration →",
    fields: [
      {
        name: "apiToken",
        label: "Internal integration token",
        type: "password",
        placeholder: "ntn_...",
      },
    ],
    helpText:
      "Create an internal integration, then share each page/database you want to link with it.",
  },
  {
    source: "jira",
    name: "Jira",
    createUrl: "https://id.atlassian.com/manage-profile/security/api-tokens",
    createLabel: "Create an Atlassian API token →",
    fields: [
      {
        name: "domain",
        label: "Atlassian domain",
        type: "text",
        placeholder: "yourco.atlassian.net",
      },
      {
        name: "email",
        label: "Email",
        type: "text",
        placeholder: "you@company.com",
      },
      { name: "apiToken", label: "API token", type: "password" },
    ],
    helpText:
      "Shares credentials with Confluence — same Atlassian API token works for both.",
  },
  {
    source: "confluence",
    name: "Confluence",
    createUrl: "https://id.atlassian.com/manage-profile/security/api-tokens",
    createLabel: "Create an Atlassian API token →",
    fields: [
      {
        name: "domain",
        label: "Atlassian domain",
        type: "text",
        placeholder: "yourco.atlassian.net",
      },
      {
        name: "email",
        label: "Email",
        type: "text",
        placeholder: "you@company.com",
      },
      { name: "apiToken", label: "API token", type: "password" },
    ],
  },
  {
    source: "slack",
    name: "Slack",
    createUrl: "https://api.slack.com/apps",
    createLabel: "Create a Slack app →",
    fields: [
      {
        name: "botToken",
        label: "Bot token",
        type: "password",
        placeholder: "xoxb-...",
      },
    ],
    helpText:
      "Bot needs channels:history, groups:history, im:history, mpim:history, users:read. The bot must be a member of each channel you link to.",
  },
  {
    source: "coda",
    name: "Coda",
    createUrl: "https://coda.io/account",
    createLabel: "Create a Coda API token →",
    fields: [{ name: "apiToken", label: "API token", type: "password" }],
  },
  {
    source: "figma",
    name: "Figma",
    createUrl: "https://www.figma.com/developers/api#access-tokens",
    createLabel: "Create a Figma access token →",
    fields: [
      {
        name: "personalAccessToken",
        label: "Personal access token",
        type: "password",
        placeholder: "figd_...",
      },
    ],
  },
];

function strategyLabel(strategy: ConnectorStrategy): string {
  switch (strategy) {
    case "mcp":
      return "MCP";
    case "api-key":
      return "API Key";
    case "oauth":
      return "OAuth";
    case "agent":
      return "Agent";
  }
}

export function ConnectorsPanel() {
  const [statuses, setStatuses] = useState<ConnectorStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.api.connectors.list().then((list) => {
      setStatuses(list);
      setLoading(false);
    });
  }, []);

  async function reload() {
    const list = await window.api.connectors.list();
    setStatuses(list);
  }

  if (loading) {
    return <div className="text-sm text-fg-muted">Loading…</div>;
  }

  return (
    <div className="flex flex-col gap-2">
      {CONNECTORS.map((meta) => {
        const status = statuses.find((s) => s.source === meta.source) ?? {
          source: meta.source,
          configured: false,
        };
        return (
          <ConnectorRow
            key={meta.source}
            meta={meta}
            status={status}
            onChange={reload}
          />
        );
      })}
    </div>
  );
}

interface RowProps {
  meta: ConnectorMeta;
  status: ConnectorStatus;
  onChange: () => Promise<void>;
}

function initialValues(
  meta: ConnectorMeta,
  status: ConnectorStatus,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of meta.fields) {
    if (field.type === "text") {
      out[field.name] = status.publicFields?.[field.name] ?? "";
    } else {
      out[field.name] = "";
    }
  }
  return out;
}

function ConnectorRow({ meta, status, onChange }: RowProps) {
  const [expanded, setExpanded] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() =>
    initialValues(meta, status),
  );
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ConnectorTestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [strategies, setStrategies] = useState<StrategyStatus[] | null>(null);
  const [loadingStrategies, setLoadingStrategies] = useState(false);

  useEffect(() => {
    setValues(initialValues(meta, status));
    setResult(null);
  }, [status.configured, JSON.stringify(status.publicFields ?? {})]);

  // Load strategies when row is expanded
  useEffect(() => {
    if (!expanded || strategies !== null) return;
    setLoadingStrategies(true);
    window.api.connectors
      .strategies(meta.source)
      .then((s) => {
        setStrategies(s);
        setLoadingStrategies(false);
      })
      .catch(() => setLoadingStrategies(false));
  }, [expanded, meta.source, strategies]);

  function setField(name: string, value: string) {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  function buildConfig(): Record<string, string> {
    const cfg: Record<string, string> = {};
    for (const field of meta.fields) {
      cfg[field.name] = values[field.name].trim();
    }
    return cfg;
  }

  const allFilled = meta.fields.every((f) => values[f.name].trim().length > 0);
  const anySecretFilled = meta.fields
    .filter((f) => f.type === "password")
    .some((f) => values[f.name].trim().length > 0);

  async function handleTest() {
    setTesting(true);
    setResult(null);
    const cfg = anySecretFilled ? buildConfig() : undefined;
    const r = await window.api.connectors.test(meta.source, cfg);
    setResult(r);
    setTesting(false);
  }

  async function handleSave() {
    if (!allFilled) return;
    setSaving(true);
    try {
      const cfg = buildConfig();
      const r = await window.api.connectors.test(meta.source, cfg);
      setResult(r);
      if (!r.ok) return;
      await window.api.connectors.set(meta.source, cfg);
      await onChange();
      // Refresh strategies after saving new credentials
      setStrategies(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    await window.api.connectors.remove(meta.source);
    setResult(null);
    setStrategies(null);
    await onChange();
  }

  async function handleOAuth() {
    setConnecting(true);
    setResult(null);
    const r = await window.api.connectors.startOAuth(meta.source);
    setResult(r);
    if (r.ok) {
      await onChange();
      setStrategies(null);
    }
    setConnecting(false);
  }

  const mcpStrategy = strategies?.find((s) => s.strategy === "mcp");
  const agentStrategy = strategies?.find((s) => s.strategy === "agent");

  return (
    <div className="border border-line rounded-sm bg-bg-card">
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 bg-transparent border-none cursor-pointer hover:bg-bg-card-hover"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm text-fg font-medium">{meta.name}</span>
          {status.configured ? (
            <span className="text-xs text-green">✓ Connected</span>
          ) : (
            <span className="text-xs text-fg-muted">Not connected</span>
          )}
          {status.activeStrategy && (
            <span className="text-xs text-fg-muted bg-bg-input px-1 rounded-sm">
              {strategyLabel(status.activeStrategy)}
            </span>
          )}
          {status.configured && status.activeStrategy !== "mcp" && (
            <>
              {status.publicFields?.domain && (
                <span className="text-xs text-fg-muted truncate">
                  {status.publicFields.domain}
                </span>
              )}
              {status.maskedKey && (
                <span className="text-xs text-fg-muted font-['SF_Mono','Fira_Code',monospace]">
                  {status.maskedKey}
                </span>
              )}
            </>
          )}
        </div>
        <span className="text-xs text-fg-muted">{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded && (
        <div className="flex flex-col gap-3 px-3 pb-3 pt-2 border-t border-line">
          {/* Strategy detection */}
          {loadingStrategies ? (
            <p className="text-xs text-fg-muted">
              Detecting available methods…
            </p>
          ) : strategies ? (
            <StrategySection
              strategies={strategies}
              mcpConfigured={mcpStrategy?.configured ?? false}
              hasAgent={agentStrategy?.configured ?? false}
            />
          ) : null}

          {/* MCP — no config needed, just status */}
          {mcpStrategy?.available && (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-fg-muted">
                {mcpStrategy.configured
                  ? `MCP server connected${mcpStrategy.detail ? ` (${mcpStrategy.detail})` : ""}.`
                  : `MCP server found${mcpStrategy.detail ? ` (${mcpStrategy.detail})` : ""} but not responding.`}
              </p>
            </div>
          )}

          {/* OAuth strategy */}
          {meta.oauth && (
            <div className="flex flex-col gap-1">
              {!mcpStrategy?.available && (
                <p className="text-xs text-fg-muted">
                  Connect via OAuth — your browser will open to authorize
                  Atrium.
                </p>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleOAuth}
                  disabled={connecting}
                >
                  {connecting
                    ? "Waiting for browser…"
                    : status.configured && status.activeStrategy === "oauth"
                      ? "Reconnect"
                      : "Connect with Linear"}
                </button>
              </div>
            </div>
          )}

          {/* API key strategy */}
          {meta.fields.length > 0 && (
            <div className="flex flex-col gap-2">
              {meta.createUrl && meta.createLabel && (
                <div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      window.api.shell.openExternal(meta.createUrl!)
                    }
                  >
                    {meta.createLabel}
                  </button>
                </div>
              )}

              {meta.helpText && (
                <p className="text-xs text-fg-muted">{meta.helpText}</p>
              )}

              {meta.fields.map((field) => (
                <div key={field.name} className="flex flex-col gap-1">
                  <label className="text-xs text-fg-muted">{field.label}</label>
                  <input
                    type={field.type}
                    className="form-input"
                    value={values[field.name]}
                    onChange={(e) => setField(field.name, e.target.value)}
                    placeholder={
                      field.type === "password" && status.configured
                        ? "Enter a new token to replace"
                        : field.placeholder
                    }
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              ))}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={handleTest}
                  disabled={testing || (!anySecretFilled && !status.configured)}
                >
                  {testing ? "Testing…" : "Test"}
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleSave}
                  disabled={saving || !allFilled}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                {status.configured && status.activeStrategy !== "mcp" && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={handleDisconnect}
                  >
                    Disconnect
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Disconnect for OAuth/MCP-only connectors */}
          {meta.fields.length === 0 &&
            status.configured &&
            status.activeStrategy !== "mcp" && (
              <button
                type="button"
                className="btn btn-ghost btn-sm self-start"
                onClick={handleDisconnect}
              >
                Disconnect
              </button>
            )}

          {result && (
            <div className={`text-xs ${result.ok ? "text-green" : "text-red"}`}>
              {result.ok
                ? `✓ Connected as ${result.identity ?? "unknown"}`
                : `✗ ${result.error}`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface StrategySectionProps {
  strategies: StrategyStatus[];
  mcpConfigured: boolean;
  hasAgent: boolean;
}

function StrategySection({
  strategies,
  mcpConfigured,
  hasAgent,
}: StrategySectionProps) {
  if (strategies.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-fg-muted font-medium">Connection methods</p>
      <div className="flex flex-col gap-[2px]">
        {strategies.map((s) => (
          <div key={s.strategy} className="flex items-center gap-2">
            <span
              className={`text-xs w-[52px] ${s.configured ? "text-green" : s.available ? "text-fg-muted" : "text-fg-muted opacity-40"}`}
            >
              {strategyLabel(s.strategy)}
            </span>
            <span className="text-xs text-fg-muted">
              {s.configured ? (
                <span className="text-green">
                  ✓{s.detail ? ` ${s.detail}` : ""}
                </span>
              ) : s.available ? (
                (s.detail ?? "available, not configured")
              ) : (
                "not available"
              )}
            </span>
          </div>
        ))}
      </div>
      {!mcpConfigured && hasAgent && (
        <p className="text-xs text-fg-muted mt-1">
          Agent fallback is active — links will be fetched via Claude Code
          (~3-10s per link, cached for 5 min).
        </p>
      )}
      {!mcpConfigured && !hasAgent && (
        <p className="text-xs text-fg-muted mt-1">
          Tip: add an MCP server for this service in Claude Code to connect
          without API keys.
        </p>
      )}
    </div>
  );
}

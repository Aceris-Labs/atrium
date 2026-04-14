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
  const [activeForm, setActiveForm] = useState<"api-key" | null>(null);

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
      setStrategies(null);
      setActiveForm(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    await window.api.connectors.remove(meta.source);
    setResult(null);
    setStrategies(null);
    setActiveForm(null);
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

  function handleStrategyClick(strategy: ConnectorStrategy) {
    if (strategy === "oauth") {
      void handleOAuth();
    } else if (strategy === "api-key") {
      setActiveForm((f) => (f === "api-key" ? null : "api-key"));
      setResult(null);
    }
    // mcp and agent connect automatically — no user action
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
          {loadingStrategies && (
            <p className="text-xs text-fg-muted">
              Detecting available methods…
            </p>
          )}

          {strategies && (
            <>
              {/* Interactive strategy list */}
              <div className="flex flex-col gap-[3px]">
                {strategies.map((s) => (
                  <StrategyRow
                    key={s.strategy}
                    s={s}
                    meta={meta}
                    status={status}
                    connecting={connecting}
                    formOpen={
                      activeForm === "api-key" && s.strategy === "api-key"
                    }
                    onConnect={() => handleStrategyClick(s.strategy)}
                    onDisconnect={handleDisconnect}
                  />
                ))}
              </div>

              {/* Inline API key form */}
              {activeForm === "api-key" && meta.fields.length > 0 && (
                <div className="flex flex-col gap-2 border-t border-line pt-3 mt-1">
                  {meta.createUrl && meta.createLabel && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm self-start"
                      onClick={() =>
                        window.api.shell.openExternal(meta.createUrl!)
                      }
                    >
                      {meta.createLabel}
                    </button>
                  )}
                  {meta.helpText && (
                    <p className="text-xs text-fg-muted">{meta.helpText}</p>
                  )}
                  {meta.fields.map((field) => (
                    <div key={field.name} className="flex flex-col gap-1">
                      <label className="text-xs text-fg-muted">
                        {field.label}
                      </label>
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
                      disabled={
                        testing || (!anySecretFilled && !status.configured)
                      }
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
                    {status.configured &&
                      status.activeStrategy === "api-key" && (
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

              {/* Footer hints */}
              {!mcpStrategy?.configured && agentStrategy?.configured && (
                <p className="text-xs text-fg-muted">
                  Agent fallback active — fetched via Claude Code (~3–10s per
                  link, cached 5 min).
                </p>
              )}
              {!mcpStrategy?.configured && !agentStrategy?.configured && (
                <p className="text-xs text-fg-muted">
                  Tip: add an MCP server for this service in Claude Code to
                  connect without API keys.
                </p>
              )}
            </>
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

interface StrategyRowProps {
  s: StrategyStatus;
  meta: ConnectorMeta;
  status: ConnectorStatus;
  connecting: boolean;
  formOpen: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

function StrategyRow({
  s,
  meta,
  status,
  connecting,
  formOpen,
  onConnect,
  onDisconnect,
}: StrategyRowProps) {
  const isOAuthActive =
    s.strategy === "oauth" &&
    status.configured &&
    status.activeStrategy === "oauth";
  const isApiKeyActive =
    s.strategy === "api-key" &&
    status.configured &&
    status.activeStrategy === "api-key";

  let cta: React.ReactNode = null;

  if (s.strategy === "mcp") {
    if (s.configured) {
      cta = <span className="text-xs text-green">Active</span>;
    } else if (s.available) {
      cta = <span className="text-xs text-red">Not responding</span>;
    }
  } else if (s.strategy === "oauth" && s.available) {
    if (isOAuthActive) {
      cta = (
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onConnect}
            disabled={connecting}
          >
            {connecting ? "Waiting…" : "Reconnect"}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onDisconnect}
          >
            Disconnect
          </button>
        </div>
      );
    } else {
      const label = `Connect with ${meta.name}`;
      cta = (
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={onConnect}
          disabled={connecting}
        >
          {connecting ? "Waiting for browser…" : label}
        </button>
      );
    }
  } else if (s.strategy === "api-key" && s.available) {
    if (isApiKeyActive) {
      cta = (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onConnect}
        >
          {formOpen ? "Cancel" : "Update token"}
        </button>
      );
    } else {
      cta = (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onConnect}
        >
          {formOpen ? "Cancel" : "Set up →"}
        </button>
      );
    }
  } else if (s.strategy === "agent") {
    if (s.configured) {
      cta = <span className="text-xs text-green">Active</span>;
    }
  }

  return (
    <div className="flex items-center gap-2 py-[3px]">
      <span
        className={`text-xs w-[60px] flex-shrink-0 ${
          s.configured
            ? "text-green"
            : s.available
              ? "text-fg-muted"
              : "text-fg-muted opacity-40"
        }`}
      >
        {strategyLabel(s.strategy)}
      </span>
      <span className="text-xs text-fg-muted flex-1 min-w-0">
        {s.configured ? (
          <span className="text-green">✓{s.detail ? ` ${s.detail}` : ""}</span>
        ) : s.available ? (
          (s.detail ?? "available")
        ) : (
          "not available"
        )}
      </span>
      {cta && <div className="flex-shrink-0">{cta}</div>}
    </div>
  );
}

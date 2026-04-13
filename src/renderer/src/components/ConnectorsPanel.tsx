import { useEffect, useState } from "react";
import type {
  ConnectorSource,
  ConnectorStatus,
  ConnectorTestResult,
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

  useEffect(() => {
    setValues(initialValues(meta, status));
    setResult(null);
  }, [status.configured, JSON.stringify(status.publicFields ?? {})]);

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
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    await window.api.connectors.remove(meta.source);
    setResult(null);
    await onChange();
  }

  async function handleOAuth() {
    setConnecting(true);
    setResult(null);
    const r = await window.api.connectors.startOAuth(meta.source);
    setResult(r);
    if (r.ok) await onChange();
    setConnecting(false);
  }

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
          {status.configured && status.publicFields?.domain && (
            <span className="text-xs text-fg-muted truncate">
              {status.publicFields.domain}
            </span>
          )}
          {status.configured && status.maskedKey && (
            <span className="text-xs text-fg-muted font-['SF_Mono','Fira_Code',monospace]">
              {status.maskedKey}
            </span>
          )}
        </div>
        <span className="text-xs text-fg-muted">{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded && (
        <div className="flex flex-col gap-2 px-3 pb-3 pt-1 border-t border-line">
          {meta.oauth ? (
            <>
              <p className="text-xs text-fg-muted">
                Connects via OAuth — your browser will open to authorize Atrium.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleOAuth}
                  disabled={connecting}
                >
                  {connecting
                    ? "Waiting for browser…"
                    : status.configured
                      ? "Reconnect"
                      : "Connect with Linear"}
                </button>
                {status.configured && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={handleDisconnect}
                  >
                    Disconnect
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
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
                {status.configured && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={handleDisconnect}
                  >
                    Disconnect
                  </button>
                )}
              </div>
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

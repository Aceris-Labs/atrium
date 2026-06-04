import { useEffect, useState } from "react";
import {
  ChevronUpIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  XMarkIcon,
} from "@heroicons/react/20/solid";
import { Checkbox } from "./Checkbox";
import type {
  DetectedTools,
  LaunchAction,
  LaunchProfile,
  LaunchShell,
  TmuxPane,
} from "../../../shared/types";

interface Props {
  /** The profile being edited. Pass a fresh copy — this component mutates via onChange. */
  profile: LaunchProfile;
  onChange: (next: LaunchProfile) => void;
  readOnly?: boolean;
}

const SHELLS: LaunchShell[] = ["zsh", "bash", "sh", "fish"];

const EDITOR_OPTIONS = [
  { value: "cursor", label: "Cursor" },
  { value: "code", label: "VS Code" },
];

const TERMINAL_OPTIONS = [
  { value: "ghostty", label: "Ghostty" },
  { value: "iterm", label: "iTerm" },
  { value: "warp", label: "Warp" },
  { value: "terminal", label: "Terminal.app" },
];

function summarize(action: LaunchAction): string {
  switch (action.type) {
    case "editor":
      return `Open ${action.app}${action.withClaude ? " + Claude" : ""}`;
    case "terminal":
      return `Open ${action.app}${action.command ? " (run command)" : ""}`;
    case "tmux":
      return `tmux in ${action.app} (${action.panes.length} pane${action.panes.length === 1 ? "" : "s"})`;
    case "command":
      return `${action.shell}: ${action.command.slice(0, 40)}${action.command.length > 40 ? "…" : ""}`;
  }
}

function blankAction(type: LaunchAction["type"]): LaunchAction {
  switch (type) {
    case "editor":
      return { type: "editor", app: "cursor" };
    case "terminal":
      return { type: "terminal", app: "ghostty" };
    case "tmux":
      return {
        type: "tmux",
        app: "ghostty",
        panes: [{ command: "" }],
      };
    case "command":
      return { type: "command", shell: "zsh", command: "" };
  }
}

export function LauncherProfileEditor({
  profile,
  onChange,
  readOnly = false,
}: Props) {
  const [tools, setTools] = useState<DetectedTools | null>(null);
  const [expandedAction, setExpandedAction] = useState<number | null>(null);

  useEffect(() => {
    window.api.setup.detect().then(setTools);
  }, []);

  function updateAction(idx: number, action: LaunchAction) {
    const next = [...profile.actions];
    next[idx] = action;
    onChange({ ...profile, actions: next });
  }

  function moveAction(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= profile.actions.length) return;
    const next = [...profile.actions];
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange({ ...profile, actions: next });
  }

  function deleteAction(idx: number) {
    const next = profile.actions.filter((_, i) => i !== idx);
    onChange({ ...profile, actions: next });
    if (expandedAction === idx) setExpandedAction(null);
  }

  function addAction(type: LaunchAction["type"]) {
    const next = [...profile.actions, blankAction(type)];
    onChange({ ...profile, actions: next });
    setExpandedAction(next.length - 1);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="form-group">
        <label className="form-label">Name</label>
        <input
          className="form-input"
          value={profile.name}
          onChange={(e) => onChange({ ...profile, name: e.target.value })}
          disabled={readOnly}
        />
      </div>

      {profile.description && (
        <p className="text-xs text-fg-muted">{profile.description}</p>
      )}

      <div className="flex flex-col gap-2">
        <label className="form-label">Actions</label>
        {profile.actions.length === 0 && (
          <p className="text-xs text-fg-muted">
            No actions yet. Add one below.
          </p>
        )}
        {profile.actions.map((action, idx) => (
          <div key={idx} className="border border-line rounded-sm bg-bg-card">
            <div className="flex items-center gap-2 px-3 py-2">
              <span className="text-xs text-fg-muted bg-bg-input px-1 rounded-sm">
                {action.type}
              </span>
              <span className="text-sm text-fg flex-1 min-w-0 break-words">
                {summarize(action)}
              </span>
              {!readOnly && (
                <>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => moveAction(idx, -1)}
                    disabled={idx === 0}
                    title="Move up"
                  >
                    <ChevronUpIcon className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => moveAction(idx, 1)}
                    disabled={idx === profile.actions.length - 1}
                    title="Move down"
                  >
                    <ChevronDownIcon className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => deleteAction(idx)}
                    title="Delete"
                  >
                    <XMarkIcon className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  setExpandedAction(expandedAction === idx ? null : idx)
                }
              >
                {expandedAction === idx ? (
                  <ChevronDownIcon className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRightIcon className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
            {expandedAction === idx && (
              <div className="px-3 pb-3 pt-1 border-t border-line">
                <ActionEditor
                  action={action}
                  onChange={(next) => updateAction(idx, next)}
                  tools={tools}
                  readOnly={readOnly}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {!readOnly && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-fg-muted">Add action:</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => addAction("editor")}
          >
            + Editor
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => addAction("terminal")}
          >
            + Terminal
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => addAction("tmux")}
          >
            + Tmux
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => addAction("command")}
          >
            + Command
          </button>
        </div>
      )}
    </div>
  );
}

// ── Per-action editors ───────────────────────────────────────────────────────

interface ActionEditorProps {
  action: LaunchAction;
  onChange: (next: LaunchAction) => void;
  tools: DetectedTools | null;
  readOnly: boolean;
}

function ActionEditor({
  action,
  onChange,
  tools,
  readOnly,
}: ActionEditorProps) {
  switch (action.type) {
    case "editor":
      return (
        <EditorActionEditor
          action={action}
          onChange={onChange}
          tools={tools}
          readOnly={readOnly}
        />
      );
    case "terminal":
      return (
        <TerminalActionEditor
          action={action}
          onChange={onChange}
          tools={tools}
          readOnly={readOnly}
        />
      );
    case "tmux":
      return (
        <TmuxActionEditor
          action={action}
          onChange={onChange}
          tools={tools}
          readOnly={readOnly}
        />
      );
    case "command":
      return (
        <CommandActionEditor
          action={action}
          onChange={onChange}
          readOnly={readOnly}
        />
      );
  }
}

function EditorActionEditor({
  action,
  onChange,
  tools,
  readOnly,
}: {
  action: Extract<LaunchAction, { type: "editor" }>;
  onChange: (next: LaunchAction) => void;
  tools: DetectedTools | null;
  readOnly: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 pt-2">
      <div className="form-group">
        <label className="form-label">Editor</label>
        <div className="flex flex-wrap gap-2">
          {EDITOR_OPTIONS.map((opt) => {
            const installed =
              tools?.editors[opt.value as "cursor" | "code"]?.installed ?? true;
            return (
              <button
                key={opt.value}
                type="button"
                className={`setup-chip${action.app === opt.value ? " active" : ""}`}
                onClick={() => onChange({ ...action, app: opt.value })}
                disabled={readOnly}
                title={installed ? undefined : "Not installed"}
              >
                {opt.label}
                {!installed && <span className="text-xs text-red ml-1">•</span>}
              </button>
            );
          })}
        </div>
      </div>
      {action.app === "code" && (
        <label className="wt-checkbox-label">
          <Checkbox
            checked={!!action.withClaude}
            onChange={() => {
              if (readOnly) return;
              onChange({ ...action, withClaude: !action.withClaude });
            }}
          />
          Open Claude panel with workspace context
        </label>
      )}
    </div>
  );
}

function TerminalActionEditor({
  action,
  onChange,
  tools,
  readOnly,
}: {
  action: Extract<LaunchAction, { type: "terminal" }>;
  onChange: (next: LaunchAction) => void;
  tools: DetectedTools | null;
  readOnly: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 pt-2">
      <div className="form-group">
        <label className="form-label">Terminal</label>
        <div className="flex flex-wrap gap-2">
          {TERMINAL_OPTIONS.map((opt) => {
            const installed =
              tools?.terminals[
                opt.value as "ghostty" | "iterm" | "terminal" | "warp"
              ]?.installed ?? true;
            return (
              <button
                key={opt.value}
                type="button"
                className={`setup-chip${action.app === opt.value ? " active" : ""}`}
                onClick={() => onChange({ ...action, app: opt.value })}
                disabled={readOnly}
                title={installed ? undefined : "Not installed"}
              >
                {opt.label}
                {!installed && <span className="text-xs text-red ml-1">•</span>}
              </button>
            );
          })}
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">
          Initial command <span className="text-fg-muted">(optional)</span>
        </label>
        <input
          className="form-input"
          value={action.command ?? ""}
          placeholder="leave blank for a plain shell"
          onChange={(e) =>
            onChange({ ...action, command: e.target.value || undefined })
          }
          disabled={readOnly}
        />
      </div>
    </div>
  );
}

function TmuxActionEditor({
  action,
  onChange,
  tools,
  readOnly,
}: {
  action: Extract<LaunchAction, { type: "tmux" }>;
  onChange: (next: LaunchAction) => void;
  tools: DetectedTools | null;
  readOnly: boolean;
}) {
  function updatePane(idx: number, pane: TmuxPane) {
    const next = [...action.panes];
    next[idx] = pane;
    onChange({ ...action, panes: next });
  }
  function movePane(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= action.panes.length) return;
    const next = [...action.panes];
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange({ ...action, panes: next });
  }
  function deletePane(idx: number) {
    onChange({
      ...action,
      panes: action.panes.filter((_, i) => i !== idx),
    });
  }
  function addPane() {
    onChange({
      ...action,
      panes: [...action.panes, { split: "h", command: "" }],
    });
  }
  function setFocus(idx: number) {
    onChange({
      ...action,
      panes: action.panes.map((p, i) => ({ ...p, focus: i === idx })),
    });
  }

  return (
    <div className="flex flex-col gap-3 pt-2">
      <div className="form-group">
        <label className="form-label">Terminal</label>
        <div className="flex flex-wrap gap-2">
          {TERMINAL_OPTIONS.map((opt) => {
            const installed =
              tools?.terminals[
                opt.value as "ghostty" | "iterm" | "terminal" | "warp"
              ]?.installed ?? true;
            return (
              <button
                key={opt.value}
                type="button"
                className={`setup-chip${action.app === opt.value ? " active" : ""}`}
                onClick={() => onChange({ ...action, app: opt.value })}
                disabled={readOnly}
                title={installed ? undefined : "Not installed"}
              >
                {opt.label}
                {!installed && <span className="text-xs text-red ml-1">•</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="form-label">Panes</label>
        <p className="text-xs text-fg-muted">
          Use <code>{"${claude}"}</code> in a command to inject the Claude CLI
          with workspace context.
        </p>
        {action.panes.map((pane, idx) => (
          <div
            key={idx}
            className="border border-line rounded-sm p-2 flex flex-col gap-2"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-fg-muted w-12">Pane {idx + 1}</span>
              {idx > 0 && (
                <select
                  className="form-input"
                  style={{ width: 60 }}
                  value={pane.split ?? "h"}
                  onChange={(e) =>
                    updatePane(idx, {
                      ...pane,
                      split: e.target.value as "h" | "v",
                    })
                  }
                  disabled={readOnly}
                >
                  <option value="h">↔ h</option>
                  <option value="v">↕ v</option>
                </select>
              )}
              {idx > 0 && (
                <input
                  type="number"
                  min={1}
                  max={99}
                  placeholder="size%"
                  className="form-input"
                  style={{ width: 70 }}
                  value={pane.size ?? ""}
                  onChange={(e) =>
                    updatePane(idx, {
                      ...pane,
                      size: e.target.value
                        ? parseInt(e.target.value, 10)
                        : undefined,
                    })
                  }
                  disabled={readOnly}
                />
              )}
              <label className="text-xs text-fg-muted flex items-center gap-1">
                <input
                  type="radio"
                  name={`focus-${action.panes.length}`}
                  checked={!!pane.focus}
                  onChange={() => setFocus(idx)}
                  disabled={readOnly}
                />
                focus
              </label>
              {!readOnly && (
                <>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => movePane(idx, -1)}
                    disabled={idx === 0}
                    title="Move up"
                  >
                    <ChevronUpIcon className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => movePane(idx, 1)}
                    disabled={idx === action.panes.length - 1}
                    title="Move down"
                  >
                    <ChevronDownIcon className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => deletePane(idx)}
                    title="Delete"
                  >
                    <XMarkIcon className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
            <input
              className="form-input"
              placeholder="command (e.g. nvim, ${claude})"
              value={pane.command ?? ""}
              onChange={(e) =>
                updatePane(idx, {
                  ...pane,
                  command: e.target.value || undefined,
                })
              }
              disabled={readOnly}
            />
          </div>
        ))}
        {!readOnly && (
          <button
            type="button"
            className="btn btn-ghost btn-sm self-start"
            onClick={addPane}
          >
            + Pane
          </button>
        )}
      </div>
    </div>
  );
}

function CommandActionEditor({
  action,
  onChange,
  readOnly,
}: {
  action: Extract<LaunchAction, { type: "command" }>;
  onChange: (next: LaunchAction) => void;
  readOnly: boolean;
}) {
  const [showEnv, setShowEnv] = useState(false);
  return (
    <div className="flex flex-col gap-2 pt-2">
      <div className="form-group">
        <label className="form-label">Shell</label>
        <select
          className="form-input"
          value={action.shell}
          onChange={(e) =>
            onChange({ ...action, shell: e.target.value as LaunchShell })
          }
          disabled={readOnly}
        >
          {SHELLS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">Command</label>
        <textarea
          className="form-input font-['SF_Mono','Fira_Code',monospace] text-xs"
          rows={4}
          value={action.command}
          onChange={(e) => onChange({ ...action, command: e.target.value })}
          disabled={readOnly}
        />
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-sm self-start"
        onClick={() => setShowEnv((v) => !v)}
      >
        {showEnv ? "Hide" : "Show"} available env vars
      </button>
      {showEnv && (
        <div className="text-xs text-fg-muted font-['SF_Mono','Fira_Code',monospace] bg-bg-input rounded-sm p-2 flex flex-col gap-1">
          <div>$ATRIUM_WORKSPACE_DIR — effective working directory</div>
          <div>$ATRIUM_WORKSPACE_ID — workspace id</div>
          <div>$ATRIUM_WORKSPACE_NAME — workspace title</div>
          <div>$ATRIUM_WING_ID — wing id</div>
          <div>$ATRIUM_WING_NAME — wing name</div>
          <div>$ATRIUM_BRANCH — branch (only set for worktrees)</div>
          <div>
            $ATRIUM_CONTEXT_FILE — temp markdown file with workspace context
          </div>
        </div>
      )}
    </div>
  );
}

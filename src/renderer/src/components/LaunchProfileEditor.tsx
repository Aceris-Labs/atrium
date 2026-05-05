import { Checkbox } from "./Checkbox";
import type { LaunchAction, DetectedTools } from "../../../shared/types";

export type Preset =
  | "editor-only"
  | "terminal-tmux"
  | "editor-and-terminal"
  | "terminal-cmd";

const PRESET_LABELS: Record<Preset, string> = {
  "editor-only": "Editor only",
  "terminal-tmux": "Terminal + tmux",
  "editor-and-terminal": "Editor + Terminal",
  "terminal-cmd": "Terminal + command",
};

export function detectPreset(profile: LaunchAction[]): Preset {
  const types = profile.map((a) => a.type);
  if (types.length === 1 && types[0] === "editor") return "editor-only";
  if (types.length === 1 && types[0] === "terminal-tmux")
    return "terminal-tmux";
  if (types.length === 1 && types[0] === "terminal-cmd") return "terminal-cmd";
  if (types.includes("editor") && types.includes("terminal-tmux"))
    return "editor-and-terminal";
  return "terminal-tmux";
}

function findAction<T extends LaunchAction["type"]>(
  profile: LaunchAction[],
  type: T,
) {
  return profile.find((a) => a.type === type) as
    | Extract<LaunchAction, { type: T }>
    | undefined;
}

export interface ProfileEditorState {
  preset: Preset;
  editorApp: "cursor" | "code";
  editorWithClaude: boolean;
  terminalApp: "ghostty" | "iterm" | "terminal" | "warp";
  customCmd: string;
}

export function initialProfileState(
  profile: LaunchAction[] | undefined,
): ProfileEditorState {
  const p = profile ?? [];
  const preset = detectPreset(p);
  const editorAction = findAction(p, "editor");
  const tmuxAction = findAction(p, "terminal-tmux");
  const cmdAction = findAction(p, "terminal-cmd");
  return {
    preset,
    editorApp: editorAction?.app ?? "cursor",
    editorWithClaude: editorAction?.withClaude ?? false,
    terminalApp: (tmuxAction?.app ??
      cmdAction?.app ??
      "ghostty") as ProfileEditorState["terminalApp"],
    customCmd: cmdAction?.command ?? "claude --resume",
  };
}

export function buildProfile(state: ProfileEditorState): LaunchAction[] {
  switch (state.preset) {
    case "editor-only":
      return [
        {
          type: "editor",
          app: state.editorApp,
          withClaude: state.editorWithClaude,
        },
      ];
    case "terminal-tmux":
      return [{ type: "terminal-tmux", app: state.terminalApp }];
    case "editor-and-terminal":
      return [
        {
          type: "editor",
          app: state.editorApp,
          withClaude: state.editorWithClaude,
        },
        { type: "terminal-tmux", app: state.terminalApp },
      ];
    case "terminal-cmd":
      return [
        {
          type: "terminal-cmd",
          app: state.terminalApp,
          command: state.customCmd,
        },
      ];
  }
}

interface Props {
  state: ProfileEditorState;
  onChange: (next: ProfileEditorState) => void;
  tools: DetectedTools | null;
}

export function LaunchProfileEditor({ state, onChange, tools }: Props) {
  const needsEditor =
    state.preset === "editor-only" || state.preset === "editor-and-terminal";
  const needsTerminal = state.preset !== "editor-only";

  const editorOptions = [
    {
      value: "cursor" as const,
      label: "Cursor",
      installed: tools?.editors.cursor.installed ?? false,
    },
    {
      value: "code" as const,
      label: "VS Code",
      installed: tools?.editors.code.installed ?? false,
    },
  ];
  const terminalOptions = [
    {
      value: "ghostty" as const,
      label: "Ghostty",
      installed: tools?.terminals.ghostty.installed ?? false,
    },
    {
      value: "iterm" as const,
      label: "iTerm",
      installed: tools?.terminals.iterm.installed ?? false,
    },
    {
      value: "warp" as const,
      label: "Warp",
      installed: tools?.terminals.warp.installed ?? false,
    },
    {
      value: "terminal" as const,
      label: "Terminal.app",
      installed: tools?.terminals.terminal.installed ?? false,
    },
  ];

  return (
    <>
      <div className="form-group">
        <label className="form-label">Launch profile</label>
        <div className="setup-inline-options">
          {(Object.entries(PRESET_LABELS) as [Preset, string][]).map(
            ([key, label]) => (
              <button
                key={key}
                className={`setup-chip${state.preset === key ? " active" : ""}`}
                onClick={() => onChange({ ...state, preset: key })}
              >
                {label}
              </button>
            ),
          )}
        </div>
      </div>

      {needsEditor && (
        <div className="form-group">
          <label className="form-label">Editor</label>
          <div className="setup-inline-options">
            {editorOptions.map((opt) => (
              <button
                key={opt.value}
                className={`setup-chip${state.editorApp === opt.value ? " active" : ""}${!opt.installed ? " disabled" : ""}`}
                onClick={() => onChange({ ...state, editorApp: opt.value })}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {state.editorApp === "code" && (
            <label className="wt-checkbox-label" style={{ marginTop: 8 }}>
              <Checkbox
                checked={state.editorWithClaude}
                onChange={() =>
                  onChange({
                    ...state,
                    editorWithClaude: !state.editorWithClaude,
                  })
                }
              />
              Open Claude panel with workspace context
            </label>
          )}
        </div>
      )}

      {needsTerminal && (
        <div className="form-group">
          <label className="form-label">Terminal</label>
          <div className="setup-inline-options">
            {terminalOptions.map((opt) => (
              <button
                key={opt.value}
                className={`setup-chip${state.terminalApp === opt.value ? " active" : ""}${!opt.installed ? " disabled" : ""}`}
                onClick={() => onChange({ ...state, terminalApp: opt.value })}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {state.preset === "terminal-cmd" && (
        <div className="form-group">
          <label className="form-label">Command</label>
          <input
            className="form-input"
            value={state.customCmd}
            onChange={(e) => onChange({ ...state, customCmd: e.target.value })}
            placeholder="claude --resume"
          />
        </div>
      )}
    </>
  );
}

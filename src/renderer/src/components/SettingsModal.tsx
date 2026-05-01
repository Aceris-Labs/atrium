import { useEffect, useState } from "react";
import { PathInput } from "./PathInput";
import { Checkbox } from "./Checkbox";
import { ConnectorsPanel } from "./ConnectorsPanel";
import type {
  AtriumConfig,
  LaunchAction,
  DetectedTools,
  Wing,
} from "../../../shared/types";

interface Props {
  wing: Wing;
  onClose: () => void;
  onSave: () => void;
  onRerunSetup: () => void;
}

type Tab = "general" | "wing" | "connectors";
type Preset =
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

function detectPreset(profile: LaunchAction[]): Preset {
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

interface ProfileEditorState {
  preset: Preset;
  editorApp: "cursor" | "code";
  editorWithClaude: boolean;
  terminalApp: "ghostty" | "iterm" | "terminal" | "warp";
  customCmd: string;
}

function initialProfileState(
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

function buildProfile(state: ProfileEditorState): LaunchAction[] {
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

interface LaunchProfileEditorProps {
  state: ProfileEditorState;
  onChange: (next: ProfileEditorState) => void;
  tools: DetectedTools | null;
}

function LaunchProfileEditor({
  state,
  onChange,
  tools,
}: LaunchProfileEditorProps) {
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

export function SettingsModal({ wing, onClose, onSave, onRerunSetup }: Props) {
  const [tab, setTab] = useState<Tab>("wing");
  const [config, setConfig] = useState<AtriumConfig | null>(null);
  const [tools, setTools] = useState<DetectedTools | null>(null);
  const [saving, setSaving] = useState(false);

  // Global state
  const [defaultProfileState, setDefaultProfileState] =
    useState<ProfileEditorState | null>(null);

  // Wing state
  const [wingName, setWingName] = useState(wing.name);
  const [wingProjectDir, setWingProjectDir] = useState(wing.projectDir ?? "");
  const [overrideProfile, setOverrideProfile] = useState<boolean>(
    wing.launchProfile !== undefined,
  );
  const [wingProfileState, setWingProfileState] =
    useState<ProfileEditorState | null>(null);

  useEffect(() => {
    window.api.config.get().then((c) => {
      setConfig(c);
      setDefaultProfileState(initialProfileState(c.defaultLaunchProfile));
      setWingProfileState(
        initialProfileState(wing.launchProfile ?? c.defaultLaunchProfile),
      );
    });
    window.api.setup.detect().then(setTools);
  }, [wing.id]);

  async function handleSave() {
    if (!config || !defaultProfileState || !wingProfileState) return;
    setSaving(true);
    try {
      // Save global config (default profile)
      await window.api.config.set({
        defaultLaunchProfile: buildProfile(defaultProfileState),
      });
      // Save wing
      await window.api.wings.update({
        ...wing,
        name: wingName.trim() || wing.name,
        projectDir: wingProjectDir.trim() || undefined,
        launchProfile: overrideProfile
          ? buildProfile(wingProfileState)
          : undefined,
      });
    } finally {
      setSaving(false);
    }
    onSave();
    onClose();
  }

  if (!config || !defaultProfileState || !wingProfileState) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 560 }}
      >
        <div className="modal-title">Settings</div>

        <div className="setup-inline-options" style={{ marginBottom: 16 }}>
          <button
            className={`setup-chip${tab === "wing" ? " active" : ""}`}
            onClick={() => setTab("wing")}
          >
            This wing ({wing.name})
          </button>
          <button
            className={`setup-chip${tab === "general" ? " active" : ""}`}
            onClick={() => setTab("general")}
          >
            General
          </button>
          <button
            className={`setup-chip${tab === "connectors" ? " active" : ""}`}
            onClick={() => setTab("connectors")}
          >
            Connectors
          </button>
        </div>

        {tab === "wing" && (
          <>
            <div className="form-group">
              <label className="form-label">Name</label>
              <input
                className="form-input"
                value={wingName}
                onChange={(e) => setWingName(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Project directory</label>
              <PathInput
                value={wingProjectDir}
                onChange={setWingProjectDir}
                placeholder="~/your-project-directory"
              />
            </div>

            <div className="form-group">
              <label className="wt-checkbox-label">
                <Checkbox
                  checked={overrideProfile}
                  onChange={() => setOverrideProfile(!overrideProfile)}
                />
                Override default launch profile for this wing
              </label>
            </div>

            {overrideProfile && (
              <LaunchProfileEditor
                state={wingProfileState}
                onChange={setWingProfileState}
                tools={tools}
              />
            )}
          </>
        )}

        {tab === "general" && (
          <>
            <p className="setup-desc" style={{ marginBottom: 12 }}>
              The default launch profile applies to wings that don't override
              it.
            </p>
            <LaunchProfileEditor
              state={defaultProfileState}
              onChange={setDefaultProfileState}
              tools={tools}
            />
            <div className="form-group" style={{ marginTop: 16 }}>
              <button className="btn btn-ghost" onClick={onRerunSetup}>
                Re-run setup wizard
              </button>
            </div>
          </>
        )}

        {tab === "connectors" && <ConnectorsPanel />}

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

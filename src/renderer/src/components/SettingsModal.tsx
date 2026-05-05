import { useEffect, useState } from "react";
import { PathInput } from "./PathInput";
import { Checkbox } from "./Checkbox";
import { ConnectorsPanel } from "./ConnectorsPanel";
import {
  LaunchProfileEditor,
  initialProfileState,
  buildProfile,
  type ProfileEditorState,
} from "./LaunchProfileEditor";
import type { AtriumConfig, DetectedTools, Wing } from "../../../shared/types";

interface Props {
  wing: Wing;
  onClose: () => void;
  onSave: () => void;
  onRerunSetup: () => void;
}

type Tab = "general" | "wing" | "connectors";

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

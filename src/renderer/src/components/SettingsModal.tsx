import { useEffect, useState } from "react";
import { PathInput } from "./PathInput";
import { ConnectorsPanel } from "./ConnectorsPanel";
import { LaunchersPanel } from "./LaunchersPanel";
import { LauncherPicker } from "./LauncherPicker";
import type { LaunchProfile, Wing } from "../../../shared/types";

interface Props {
  wing: Wing;
  onClose: () => void;
  onSave: () => void;
  onRerunSetup: () => void;
}

type Tab = "general" | "wing" | "launchers" | "connectors";

export function SettingsModal({ wing, onClose, onSave, onRerunSetup }: Props) {
  const [tab, setTab] = useState<Tab>("wing");
  const [saving, setSaving] = useState(false);

  // Wing state
  const [wingName, setWingName] = useState(wing.name);
  const [wingProjectDir, setWingProjectDir] = useState(wing.projectDir ?? "");
  const [wingLauncherId, setWingLauncherId] = useState<string | null>(
    wing.launchProfile ?? null,
  );

  // Launchers info (for inherit label)
  const [profiles, setProfiles] = useState<LaunchProfile[]>([]);
  const [globalDefault, setGlobalDefault] = useState<string | null>(null);

  useEffect(() => {
    window.api.launchers.list().then((d) => {
      setProfiles(d.profiles);
      setGlobalDefault(d.globalDefault);
    });
  }, [wing.id]);

  const globalDefaultName =
    profiles.find((p) => p.id === globalDefault)?.name ?? "none";

  async function handleSave() {
    setSaving(true);
    try {
      await window.api.wings.update({
        ...wing,
        name: wingName.trim() || wing.name,
        projectDir: wingProjectDir.trim() || undefined,
        launchProfile: wingLauncherId ?? undefined,
      });
    } finally {
      setSaving(false);
    }
    onSave();
    onClose();
  }

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
            className={`setup-chip${tab === "launchers" ? " active" : ""}`}
            onClick={() => setTab("launchers")}
          >
            Launchers
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
              <label className="form-label">Launcher</label>
              <LauncherPicker
                scope="wing"
                value={wingLauncherId}
                inheritedFromLabel="global default"
                inheritedFromName={globalDefaultName}
                onChange={setWingLauncherId}
              />
            </div>
          </>
        )}

        {tab === "launchers" && <LaunchersPanel />}

        {tab === "general" && (
          <div className="form-group">
            <button className="btn btn-ghost" onClick={onRerunSetup}>
              Re-run setup wizard
            </button>
          </div>
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

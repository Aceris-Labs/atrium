import { useState } from "react";
import { PathInput } from "./PathInput";

interface Props {
  onCreate: (data: { name: string; rootDir?: string }) => void;
  onClose: () => void;
}

export function CreateWingModal({ onCreate, onClose }: Props) {
  const [name, setName] = useState("");
  const [rootDir, setRootDir] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      await onCreate({
        name: name.trim(),
        rootDir: rootDir.trim() || undefined,
      });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 440 }}
      >
        <div className="modal-title">New wing</div>
        <form onSubmit={handleSubmit} style={{ display: "contents" }}>
          <div className="form-group">
            <label className="form-label">Name</label>
            <input
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Work"
              autoFocus
            />
          </div>
          <div className="form-group">
            <label className="form-label">Root directory (optional)</label>
            <PathInput
              value={rootDir}
              onChange={setRootDir}
              placeholder="~/projects/myproject"
            />
          </div>
          <p className="setup-desc" style={{ marginBottom: 12 }}>
            This wing will inherit the default launch profile. You can change it
            later in Settings.
          </p>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={creating || !name.trim()}
            >
              {creating ? "Creating…" : "Create wing"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

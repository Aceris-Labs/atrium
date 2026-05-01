import { useState } from "react";
import type { Workspace } from "../../../shared/types";

interface Props {
  onAdd: (data: Omit<Workspace, "id" | "createdAt" | "updatedAt">) => void;
  onClose: () => void;
}

export function AddWorkspaceModal({ onAdd, onClose }: Props) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<Workspace["type"]>("feature");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onAdd({
      title: title.trim(),
      type,
      status: "active",
      prs: [],
      items: [],
      links: [],
    });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">New workspace</div>
        <form onSubmit={handleSubmit} style={{ display: "contents" }}>
          <div className="form-group">
            <label className="form-label">Title</label>
            <input
              className="form-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. auth-refactor"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label">Type</label>
            <select
              className="form-select"
              value={type}
              onChange={(e) => setType(e.target.value as Workspace["type"])}
            >
              <option value="feature">feature</option>
              <option value="research">research</option>
              <option value="bug">bug</option>
            </select>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Add workspace
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

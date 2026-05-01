import { useEffect, useState } from "react";
import type { Workspace } from "../../../shared/types";

type Tab = "create" | "script";

interface Props {
  wingId: string;
  workspace: Workspace;
  projectDir: string;
  onCreated: (updated: Workspace) => void;
  onClose: () => void;
}

function suggestPath(projectDir: string, name: string): string {
  if (!name || !projectDir) return "";
  const stripped = projectDir.replace(/\/$/, "");
  const lastSlash = stripped.lastIndexOf("/");
  if (lastSlash < 0) return `${stripped}-${name}`;
  const parent = stripped.slice(0, lastSlash);
  const base = stripped.slice(lastSlash + 1);
  return `${parent}/${base}-${name}`;
}

export function CreateWorktreeModal({
  wingId,
  workspace,
  projectDir,
  onCreated,
  onClose,
}: Props) {
  const [tab, setTab] = useState<Tab>("create");

  // Create tab
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [pathEdited, setPathEdited] = useState(false);

  // Script tab
  const [command, setCommand] = useState("");

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pathEdited) {
      setPath(suggestPath(projectDir, name));
    }
  }, [name, projectDir, pathEdited]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const params =
        tab === "create"
          ? ({ tab: "create", name: name.trim(), path: path.trim() } as const)
          : ({ tab: "script", command: command.trim() } as const);
      const updated = await window.api.workspace.createWorktree(
        wingId,
        workspace.id,
        params,
      );
      onCreated(updated);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create worktree");
    } finally {
      setCreating(false);
    }
  }

  const canSubmit =
    tab === "create"
      ? name.trim().length > 0 && path.trim().length > 0
      : command.trim().length > 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 480 }}
      >
        <div className="modal-title">Create worktree</div>

        <div className="setup-inline-options" style={{ marginBottom: 16 }}>
          <button
            className={`setup-chip${tab === "create" ? " active" : ""}`}
            onClick={() => setTab("create")}
            type="button"
          >
            Create
          </button>
          <button
            className={`setup-chip${tab === "script" ? " active" : ""}`}
            onClick={() => setTab("script")}
            type="button"
          >
            Script
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "contents" }}>
          {tab === "create" && (
            <>
              <div className="form-group">
                <label className="form-label">Branch name</label>
                <input
                  className="form-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="my-feature"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="form-label">Worktree path</label>
                <input
                  className="form-input"
                  value={path}
                  onChange={(e) => {
                    setPath(e.target.value);
                    setPathEdited(true);
                  }}
                  placeholder={suggestPath(projectDir, "my-feature")}
                />
              </div>
              <p className="setup-desc" style={{ marginBottom: 0 }}>
                Runs{" "}
                <code>
                  git worktree add -b {name || "<branch>"} {path || "<path>"}
                </code>{" "}
                from the project directory.
              </p>
            </>
          )}

          {tab === "script" && (
            <>
              <div className="form-group">
                <label className="form-label">Command</label>
                <input
                  className="form-input"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="./scripts/new-worktree.sh my-feature"
                  autoFocus
                />
              </div>
              <p className="setup-desc" style={{ marginBottom: 0 }}>
                Runs from the project directory. The worktree path is read from
                stdout.
              </p>
            </>
          )}

          {error && (
            <p className="text-xs mt-3" style={{ color: "var(--red)" }}>
              {error}
            </p>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={creating || !canSubmit}
            >
              {creating ? "Creating…" : "Create worktree"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

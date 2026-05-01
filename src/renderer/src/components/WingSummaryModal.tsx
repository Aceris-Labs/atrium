import { useState, useMemo } from "react";
import { Checkbox } from "./Checkbox";
import type { Workspace, Wing } from "../../../shared/types";

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  blocked: "Blocked",
  done: "Done",
  archived: "Archived",
};

interface Props {
  workspaces: Workspace[];
  wing: Wing | null;
  onClose: () => void;
}

export function WingSummaryModal({ workspaces, wing, onClose }: Props) {
  const customGroupMap = useMemo(
    () => new Map((wing?.customGroups ?? []).map((g) => [g.id, g.name])),
    [wing],
  );

  function getGroupLabel(w: Workspace): string {
    if (w.groupId && customGroupMap.has(w.groupId)) {
      return customGroupMap.get(w.groupId)!;
    }
    return STATUS_LABELS[w.status] ?? w.status;
  }

  const groups = useMemo(() => {
    const seen = new Map<string, string>(); // id → label
    for (const w of workspaces) {
      const id =
        w.groupId && customGroupMap.has(w.groupId) ? w.groupId : w.status;
      const label = getGroupLabel(w);
      if (!seen.has(id)) seen.set(id, label);
    }
    return Array.from(seen.entries()).map(([id, label]) => ({ id, label }));
  }, [workspaces, customGroupMap]);

  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  const visibleWorkspaces = selectedGroup
    ? workspaces.filter((w) => {
        const id =
          w.groupId && customGroupMap.has(w.groupId) ? w.groupId : w.status;
        return id === selectedGroup;
      })
    : workspaces;

  const [selected, setSelected] = useState<Set<string>>(
    new Set(workspaces.map((w) => w.id)),
  );
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function toggleAll() {
    if (visibleWorkspaces.every((w) => selected.has(w.id))) {
      setSelected((prev) => {
        const next = new Set(prev);
        visibleWorkspaces.forEach((w) => next.delete(w.id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        visibleWorkspaces.forEach((w) => next.add(w.id));
        return next;
      });
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function generate() {
    const ids = Array.from(selected);
    if (ids.length === 0 || !wing) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const summary = await window.api.wing.summarize(wing.id, ids);
      setResult(summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate summary");
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!result) return;
    await navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const allVisibleChecked =
    visibleWorkspaces.length > 0 &&
    visibleWorkspaces.every((w) => selected.has(w.id));
  const someVisibleChecked = visibleWorkspaces.some((w) => selected.has(w.id));
  const noneChecked = selected.size === 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal w-[600px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-title">Summarize Wing</div>

        {!result ? (
          <>
            <p className="text-sm text-fg-muted mb-4">
              Select the spaces to include in the summary.
            </p>

            {/* Group filter chips */}
            {groups.length > 1 && (
              <div className="flex flex-wrap gap-1 mb-3">
                <button
                  className={`px-2 py-0.5 rounded-sm text-xs border transition-colors ${selectedGroup === null ? "bg-bg-card border-line text-fg" : "border-transparent text-fg-muted hover:text-fg hover:bg-bg-card-hover"}`}
                  onClick={() => setSelectedGroup(null)}
                >
                  All
                </button>
                {groups.map(({ id, label }) => (
                  <button
                    key={id}
                    className={`px-2 py-0.5 rounded-sm text-xs border transition-colors ${selectedGroup === id ? "bg-bg-card border-line text-fg" : "border-transparent text-fg-muted hover:text-fg hover:bg-bg-card-hover"}`}
                    onClick={() =>
                      setSelectedGroup(selectedGroup === id ? null : id)
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {/* Select all toggle */}
            <label className="flex items-center gap-2 text-sm text-fg-muted mb-2 cursor-pointer select-none">
              <Checkbox
                checked={allVisibleChecked}
                indeterminate={!allVisibleChecked && someVisibleChecked}
                onChange={toggleAll}
              />
              {selectedGroup
                ? `All in ${groups.find((g) => g.id === selectedGroup)?.label}`
                : "All spaces"}
            </label>

            <div className="flex flex-col gap-1 mb-4 max-h-[200px] overflow-y-auto">
              {visibleWorkspaces.map((w) => (
                <label
                  key={w.id}
                  className="flex items-center gap-2 text-sm text-fg cursor-pointer select-none px-1 py-0.5 rounded-sm hover:bg-bg-card-hover"
                >
                  <Checkbox
                    checked={selected.has(w.id)}
                    onChange={() => toggle(w.id)}
                  />
                  <span className="flex-1 truncate">{w.title}</span>
                  <span className="text-xs text-fg-muted shrink-0">
                    {getGroupLabel(w)}
                  </span>
                </label>
              ))}
            </div>

            {error && <p className="text-sm text-red mb-3">{error}</p>}

            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={generate}
                disabled={loading || noneChecked}
              >
                {loading ? "Generating…" : "Generate Summary"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto text-sm text-fg leading-relaxed whitespace-pre-wrap rounded-md border border-line bg-bg-input px-4 py-3 mb-4 min-h-0">
              {result}
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setResult(null);
                  setError(null);
                }}
              >
                ← Back
              </button>
              <button className="btn btn-ghost" onClick={copy}>
                {copied ? "Copied!" : "Copy"}
              </button>
              <button className="btn btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg/60 rounded-md">
            <div className="flex flex-col items-center gap-3">
              <div className="spinner" />
              <span className="text-sm text-fg-muted">Generating summary…</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

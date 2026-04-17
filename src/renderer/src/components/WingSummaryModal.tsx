import { useState } from "react";
import type { Workspace, PRStatus, LinkStatus } from "../../../shared/types";

interface Props {
  workspaces: Workspace[];
  prStatuses: PRStatus[];
  onClose: () => void;
}

export function WingSummaryModal({ workspaces, prStatuses, onClose }: Props) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(workspaces.map((w) => w.id)),
  );
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function toggleAll() {
    if (selected.size === workspaces.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(workspaces.map((w) => w.id)));
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
    const selectedWorkspaces = workspaces.filter((w) => selected.has(w.id));
    if (selectedWorkspaces.length === 0) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // Hydrate all links from selected workspaces
      const allUrls = [
        ...new Set(
          selectedWorkspaces.flatMap((w) => w.links.map((l) => l.url)),
        ),
      ];
      let linkStatuses: Record<string, LinkStatus> = {};
      if (allUrls.length > 0) {
        linkStatuses = await window.api.links.hydrate(allUrls);
      }

      const summary = await window.api.wing.summarize(
        selectedWorkspaces,
        prStatuses,
        linkStatuses,
      );
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

  const allChecked = selected.size === workspaces.length;
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

            {/* Select all toggle */}
            <label className="flex items-center gap-2 text-sm text-fg-muted mb-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allChecked}
                ref={(el) => {
                  if (el) el.indeterminate = !allChecked && !noneChecked;
                }}
                onChange={toggleAll}
                className="w-4 h-4 rounded border-line accent-blue"
              />
              All spaces
            </label>

            <div className="flex flex-col gap-1 mb-4 max-h-[200px] overflow-y-auto">
              {workspaces.map((w) => (
                <label
                  key={w.id}
                  className="flex items-center gap-2 text-sm text-fg cursor-pointer select-none px-1 py-0.5 rounded-sm hover:bg-bg-card-hover"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(w.id)}
                    onChange={() => toggle(w.id)}
                    className="w-4 h-4 rounded border-line accent-blue"
                  />
                  <span className="flex-1 truncate">{w.title}</span>
                  <span className="text-xs text-fg-muted shrink-0">
                    {w.status}
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

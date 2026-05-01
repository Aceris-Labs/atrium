import { useState } from "react";

interface Props {
  onWatch: (input: string) => Promise<string | null>;
  onClose: () => void;
}

export function WatchPRModal({ onWatch, onClose }: Props) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    const err = await onWatch(trimmed);
    setSubmitting(false);
    if (err) {
      setError(err);
      return;
    }
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Watch a pull request</div>
        <form onSubmit={handleSubmit} style={{ display: "contents" }}>
          <div className="form-group">
            <label className="form-label">PR number or GitHub URL</label>
            <input
              className="form-input"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setError("");
              }}
              placeholder="1234 or https://github.com/owner/repo/pull/1234"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
            {error && (
              <div className="text-red text-sm mt-1">{error}</div>
            )}
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!input.trim() || submitting}
            >
              {submitting ? "Watching…" : "Watch"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

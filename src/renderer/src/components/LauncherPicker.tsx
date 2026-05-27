import { useEffect, useState } from "react";
import { LauncherProfileEditor } from "./LauncherProfileEditor";
import type {
  DetectedTools,
  LaunchAction,
  LaunchProfile,
} from "../../../shared/types";

type Scope = "global" | "wing" | "workspace";

interface Props {
  scope: Scope;
  /** Current value: a profile id, or null to inherit. */
  value: string | null;
  /** For non-global scopes: name of the launcher inherited from the next level up. */
  inheritedFromName?: string;
  /** For non-global scopes: which level is being inherited from ("global" / "wing"). */
  inheritedFromLabel?: string;
  onChange: (id: string | null) => void;
}

export function LauncherPicker({
  scope,
  value,
  inheritedFromName,
  inheritedFromLabel,
  onChange,
}: Props) {
  const [profiles, setProfiles] = useState<LaunchProfile[]>([]);
  const [tools, setTools] = useState<DetectedTools | null>(null);
  const [editing, setEditing] = useState<LaunchProfile | null>(null);

  useEffect(() => {
    reload();
    window.api.setup.detect().then(setTools);
  }, []);

  async function reload() {
    const { profiles } = await window.api.launchers.list();
    setProfiles(profiles);
  }

  const selected = value ? profiles.find((p) => p.id === value) : null;

  async function handleSelect(next: string | null) {
    onChange(next);
  }

  function handleNew() {
    setEditing({
      id: "",
      name: "New launcher",
      actions: [],
    });
  }

  function handleDuplicate() {
    if (!selected) return;
    const copy: LaunchProfile = {
      id: "",
      name: `${selected.name} (copy)`,
      actions: selected.actions.map((a) => ({ ...a })),
    };
    setEditing(copy);
  }

  async function handleSaveEdited(profile: LaunchProfile) {
    // Generate an id if this is a fresh profile (empty id from "New" or "Duplicate").
    const toSave: LaunchProfile = profile.id
      ? profile
      : { ...profile, id: `user:${crypto.randomUUID()}` };
    const saved = await window.api.launchers.upsert(toSave);
    await reload();
    onChange(saved.id);
    setEditing(null);
  }

  const availability = selected
    ? checkAvailability(selected.actions, tools)
    : null;

  const inheritLabel =
    scope === "global"
      ? null
      : `Inherit${inheritedFromLabel ? ` from ${inheritedFromLabel}` : ""}${
          inheritedFromName ? ` (${inheritedFromName})` : ""
        }`;

  return (
    <div className="flex flex-col gap-2">
      <select
        className="form-input"
        value={value ?? "__inherit__"}
        onChange={(e) =>
          handleSelect(e.target.value === "__inherit__" ? null : e.target.value)
        }
      >
        {inheritLabel && <option value="__inherit__">{inheritLabel}</option>}
        {profiles.map((p) => {
          const avail = checkAvailability(p.actions, tools);
          return (
            <option key={p.id} value={p.id}>
              {p.name}
              {avail ? ` — ${avail}` : ""}
            </option>
          );
        })}
      </select>

      {selected?.description && (
        <p className="text-xs text-fg-muted">{selected.description}</p>
      )}
      {availability && <p className="text-xs text-red">⚠ {availability}</p>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={handleNew}
        >
          + New launcher…
        </button>
        {selected && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={handleDuplicate}
          >
            Duplicate
          </button>
        )}
      </div>

      {editing && (
        <EditorModal
          initial={editing}
          onCancel={() => setEditing(null)}
          onSave={handleSaveEdited}
        />
      )}
    </div>
  );
}

// ── Availability check ───────────────────────────────────────────────────────

function checkAvailability(
  actions: LaunchAction[],
  tools: DetectedTools | null,
): string | null {
  if (!tools) return null;
  const missing: string[] = [];
  for (const a of actions) {
    switch (a.type) {
      case "editor": {
        const editors = tools.editors as Record<string, { installed: boolean }>;
        if (!editors[a.app]?.installed) missing.push(a.app);
        break;
      }
      case "terminal":
      case "tmux": {
        const terminals = tools.terminals as Record<
          string,
          { installed: boolean }
        >;
        if (!terminals[a.app]?.installed) missing.push(a.app);
        break;
      }
    }
  }
  if (missing.length === 0) return null;
  return `Not installed: ${[...new Set(missing)].join(", ")}`;
}

// ── Editor modal ─────────────────────────────────────────────────────────────

interface EditorModalProps {
  initial: LaunchProfile;
  onCancel: () => void;
  onSave: (profile: LaunchProfile) => void;
}

function EditorModal({ initial, onCancel, onSave }: EditorModalProps) {
  const [draft, setDraft] = useState<LaunchProfile>(initial);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!draft.name.trim()) return;
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 600 }}
      >
        <div className="modal-title">
          {initial.id ? "Edit launcher" : "New launcher"}
        </div>
        <LauncherProfileEditor profile={draft} onChange={setDraft} />
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving || !draft.name.trim()}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

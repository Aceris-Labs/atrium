import { useEffect, useState } from "react";
import { LauncherProfileEditor } from "./LauncherProfileEditor";
import type { LaunchProfile } from "../../../shared/types";

export function LaunchersPanel() {
  const [profiles, setProfiles] = useState<LaunchProfile[]>([]);
  const [globalDefault, setGlobalDefault] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, LaunchProfile>>({});

  useEffect(() => {
    reload(true);
  }, []);

  async function reload(initial = false) {
    const { profiles, globalDefault } = await window.api.launchers.list();
    setProfiles(profiles);
    setGlobalDefault(globalDefault);
    if (initial) {
      setSelectedId(globalDefault ?? profiles[0]?.id ?? null);
    }
  }

  function getDraft(profile: LaunchProfile): LaunchProfile {
    return drafts[profile.id] ?? profile;
  }

  function setDraft(profile: LaunchProfile) {
    setDrafts((prev) => ({ ...prev, [profile.id]: profile }));
  }

  function clearDraft(id: string) {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  async function handleSave(profile: LaunchProfile) {
    await window.api.launchers.upsert(profile);
    clearDraft(profile.id);
    await reload();
  }

  async function handleDelete(profile: LaunchProfile) {
    if (!confirm(`Delete "${profile.name}"?`)) return;
    try {
      await window.api.launchers.remove(profile.id);
      clearDraft(profile.id);
      const remaining = profiles.filter((p) => p.id !== profile.id);
      setSelectedId(remaining[0]?.id ?? null);
      await reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function handleDuplicate(profile: LaunchProfile) {
    const copy: LaunchProfile = {
      id: `user:${crypto.randomUUID()}`,
      name: `${profile.name} (copy)`,
      actions: profile.actions.map((a) => ({ ...a })),
    };
    await window.api.launchers.upsert(copy);
    await reload();
    setSelectedId(copy.id);
  }

  async function handleNew() {
    const fresh: LaunchProfile = {
      id: `user:${crypto.randomUUID()}`,
      name: "New launcher",
      actions: [],
    };
    await window.api.launchers.upsert(fresh);
    await reload();
    setSelectedId(fresh.id);
  }

  async function handleSetGlobalDefault(id: string) {
    await window.api.launchers.setGlobalDefault(id);
    await reload();
  }

  const selected = profiles.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="form-group">
        <label className="form-label">Global default</label>
        <select
          className="form-input"
          value={globalDefault ?? ""}
          onChange={(e) => handleSetGlobalDefault(e.target.value)}
        >
          {!globalDefault && <option value="">(none)</option>}
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-fg-muted mt-1">
          Used when a wing or workspace doesn't override the launcher.
        </p>
      </div>

      <div className="flex border border-line rounded-sm overflow-hidden min-h-[400px]">
        <LauncherList
          profiles={profiles}
          selectedId={selectedId}
          globalDefault={globalDefault}
          dirtyIds={new Set(Object.keys(drafts))}
          onSelect={setSelectedId}
          onNew={handleNew}
        />
        <div className="flex-1 bg-bg-card p-4 overflow-auto">
          {selected ? (
            <LauncherDetail
              profile={selected}
              draft={getDraft(selected)}
              isDefault={selected.id === globalDefault}
              dirty={
                !!drafts[selected.id] &&
                JSON.stringify(drafts[selected.id]) !== JSON.stringify(selected)
              }
              onDraftChange={setDraft}
              onSave={() => handleSave(getDraft(selected))}
              onRevert={() => clearDraft(selected.id)}
              onDuplicate={() => handleDuplicate(selected)}
              onDelete={() => handleDelete(selected)}
              onSetDefault={() => handleSetGlobalDefault(selected.id)}
            />
          ) : (
            <div className="text-sm text-fg-muted">
              Select a launcher on the left, or create a new one.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface LauncherListProps {
  profiles: LaunchProfile[];
  selectedId: string | null;
  globalDefault: string | null;
  dirtyIds: Set<string>;
  onSelect: (id: string) => void;
  onNew: () => void;
}

function LauncherList({
  profiles,
  selectedId,
  globalDefault,
  dirtyIds,
  onSelect,
  onNew,
}: LauncherListProps) {
  return (
    <div className="w-[220px] border-r border-line bg-bg flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-line">
        <span className="text-xs text-fg-muted uppercase tracking-[0.05em]">
          Launchers
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onNew}
          title="New launcher"
        >
          + New
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {profiles.map((p) => {
          const selected = p.id === selectedId;
          const isDefault = p.id === globalDefault;
          const dirty = dirtyIds.has(p.id);
          const tags: string[] = [];
          if (p.isSystem) tags.push("system");
          if (isDefault) tags.push("default");
          const actionSummary =
            p.actions.length === 0
              ? "no actions"
              : Array.from(new Set(p.actions.map((a) => a.type))).join(" · ");
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect(p.id)}
              className={`w-full text-left px-3 py-2 border-b border-line bg-transparent border-l-2 cursor-pointer ${
                selected
                  ? "bg-bg-card-hover border-l-fg-link"
                  : "border-l-transparent hover:bg-bg-card-hover"
              }`}
            >
              <div className="flex items-center gap-1 min-w-0">
                <span className="text-sm text-fg font-medium truncate flex-1">
                  {p.name}
                </span>
                {dirty && (
                  <span className="text-xs text-yellow" title="Unsaved changes">
                    ●
                  </span>
                )}
              </div>
              <div className="text-xs text-fg-muted truncate">
                {tags.length > 0 && (
                  <span className="text-fg-muted">
                    {tags.join(" · ")}
                    {" · "}
                  </span>
                )}
                {actionSummary}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface LauncherDetailProps {
  profile: LaunchProfile;
  draft: LaunchProfile;
  isDefault: boolean;
  dirty: boolean;
  onDraftChange: (next: LaunchProfile) => void;
  onSave: () => void;
  onRevert: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
}

function LauncherDetail({
  profile,
  draft,
  isDefault,
  dirty,
  onDraftChange,
  onSave,
  onRevert,
  onDuplicate,
  onDelete,
  onSetDefault,
}: LauncherDetailProps) {
  const readOnly = !!profile.isSystem;

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-lg text-fg font-medium m-0">{profile.name}</h3>
        {profile.isSystem && (
          <span className="text-xs text-fg-muted bg-bg-input px-1 rounded-sm">
            system
          </span>
        )}
        {isDefault && (
          <span className="text-xs text-green bg-bg-input px-1 rounded-sm">
            default
          </span>
        )}
      </div>

      {readOnly && (
        <p className="text-xs text-fg-muted m-0">
          Built-in launcher — duplicate to customize.
        </p>
      )}

      <LauncherProfileEditor
        profile={draft}
        onChange={onDraftChange}
        readOnly={readOnly}
      />

      <div className="flex-1" />

      <div className="flex items-center gap-2 flex-wrap pt-3 border-t border-line">
        {!readOnly && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onSave}
            disabled={!dirty || !draft.name.trim()}
          >
            Save
          </button>
        )}
        {!readOnly && dirty && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onRevert}
          >
            Revert
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onDuplicate}
        >
          {readOnly ? "Duplicate to customize" : "Duplicate"}
        </button>
        {!isDefault && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onSetDefault}
          >
            Set as default
          </button>
        )}
        <div className="flex-1" />
        {!readOnly && !isDefault && (
          <button
            type="button"
            className="btn btn-ghost btn-sm text-red"
            onClick={onDelete}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

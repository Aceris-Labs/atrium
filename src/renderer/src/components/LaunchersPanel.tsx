import { useEffect, useState } from "react";
import { LauncherProfileEditor } from "./LauncherProfileEditor";
import type { LaunchProfile } from "../../../shared/types";

export function LaunchersPanel() {
  const [profiles, setProfiles] = useState<LaunchProfile[]>([]);
  const [globalDefault, setGlobalDefault] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, LaunchProfile>>({});

  useEffect(() => {
    reload();
  }, []);

  async function reload() {
    const { profiles, globalDefault } = await window.api.launchers.list();
    setProfiles(profiles);
    setGlobalDefault(globalDefault);
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
    setExpandedId(copy.id);
  }

  async function handleNew() {
    const fresh: LaunchProfile = {
      id: `user:${crypto.randomUUID()}`,
      name: "New launcher",
      actions: [],
    };
    await window.api.launchers.upsert(fresh);
    await reload();
    setExpandedId(fresh.id);
  }

  async function handleSetGlobalDefault(id: string) {
    await window.api.launchers.setGlobalDefault(id);
    await reload();
  }

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

      <div className="flex items-center justify-between">
        <label className="form-label">Launchers</label>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={handleNew}
        >
          + New launcher
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {profiles.map((profile) => {
          const expanded = expandedId === profile.id;
          const draft = getDraft(profile);
          const isDefault = profile.id === globalDefault;
          const dirty =
            !!drafts[profile.id] &&
            JSON.stringify(drafts[profile.id]) !== JSON.stringify(profile);

          return (
            <div
              key={profile.id}
              className="border border-line rounded-sm bg-bg-card"
            >
              <button
                type="button"
                className="w-full flex items-center justify-between px-3 py-2 bg-transparent border-none cursor-pointer hover:bg-bg-card-hover"
                onClick={() => {
                  setExpandedId(expanded ? null : profile.id);
                  if (expanded && drafts[profile.id]) clearDraft(profile.id);
                }}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="text-sm text-fg font-medium">
                    {profile.name}
                  </span>
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
                  <span className="text-xs text-fg-muted truncate">
                    {profile.actions.length === 0
                      ? "no actions"
                      : profile.actions.map((a) => a.type).join(" + ")}
                  </span>
                </div>
                <span className="text-xs text-fg-muted">
                  {expanded ? "▾" : "▸"}
                </span>
              </button>

              {expanded && (
                <div className="flex flex-col gap-3 px-3 pb-3 pt-2 border-t border-line">
                  <LauncherProfileEditor
                    profile={draft}
                    onChange={setDraft}
                    readOnly={!!profile.isSystem}
                  />
                  <div className="flex items-center gap-2">
                    {!profile.isSystem && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => handleSave(draft)}
                        disabled={!dirty || !draft.name.trim()}
                      >
                        Save
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleDuplicate(profile)}
                    >
                      {profile.isSystem
                        ? "Duplicate to customize"
                        : "Duplicate"}
                    </button>
                    {!profile.isSystem && !isDefault && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm text-red"
                        onClick={() => handleDelete(profile)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

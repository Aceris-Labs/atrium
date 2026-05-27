# Pluggable Launcher Plan

## Framing

Atrium is a workspace organizer. The launcher is a pluggable utility, not a tmux UI. The current three-pane tmux setup is one user's preference, not the product. This plan makes the launcher fully configurable: named, reusable `LaunchProfile` records composed of an ordered list of actions, with overrides at global / wing / workspace scopes, managed through a Settings UI that mirrors the Connectors pattern and a single reusable picker used everywhere a launcher is selected.

### Design decisions

1. A profile is a named, ordered list of actions. No "kind" enum at the profile level — composability is the model.
2. System profiles are **read-only**. Duplicate to customize. Their `isSystem` flag means "no edit, no delete."
3. Override hierarchy: global default → wing → workspace. Always inline on the wing/workspace record as a profile id.
4. Workspace context exposed to launchers as `ATRIUM_*` env vars (stable contract).
5. Launch never mutates the workspace — no branch checkout, no fetch, just `cd` into the effective dir.
6. Per-action failure aborts the rest of the profile and surfaces a toast.
7. One reusable `<LauncherPicker>` component is used in wizard, Settings global-default, wing settings, and workspace settings.
8. Existing `defaultLaunchProfile` config, inline wing/workspace `launchProfile` arrays, and per-project `.atrium.json` files are migrated in a single ruthless pass with a backup.

## Phase 1 — Types (`src/shared/types.ts`)

```ts
type LaunchProfile = {
  id: string;
  name: string;
  description?: string;   // shown as subtext in pickers; populated for system profiles
  isSystem?: boolean;     // read-only and undeletable; duplicate to customize
  actions: LaunchAction[];
};

type LaunchAction =
  | { type: "editor";   app: string; withClaude?: boolean }
  | { type: "terminal"; app: string; command?: string }
  | { type: "tmux";     app: string; panes: TmuxPane[] }
  | { type: "command";  shell: "zsh" | "bash" | "sh" | "fish"; command: string };
```

`Wing.launchProfile` and `Workspace.launchProfile` change from `LaunchAction[]` → `string | undefined` (profile id; absent = inherit). `AtriumConfig.defaultLaunchProfile` → `AtriumConfig.defaultLauncherId: string`.

## Phase 2 — Main process: `src/main/launchers/`

### `store.ts`

Persists `{ profiles, defaults: { global: string } }` under a new `launchers` key in `~/.atrium/config.json`. Wing/workspace overrides remain inline on those records.

API:

- `listProfiles()`, `getProfile(id)`, `upsertProfile(p)` (rejects edits to `isSystem` profiles),
- `removeProfile(id)` (rejects `isSystem` and the current `defaults.global`),
- `setGlobalDefault(id)`,
- `resolveForWorkspace(wingId, workspaceId) → LaunchProfile` — walks workspace → wing → global.

### `detect.ts`

`detectLaunchTools() → { editors, terminals, tmux, shells }` with `{ installed, version? }` per entry. Used by registry, wizard, and availability badges.

### `registry.ts`

`seedSystemProfiles(detected)`: idempotent, keyed by stable ids like `system:editor:cursor`, `system:terminal:ghostty`, `system:tmux:default`. Emits:

- One system editor profile per detected editor (`isSystem: true`, description like "Opens Cursor at the workspace directory").
- One system terminal profile per detected terminal.
- A "Three-pane tmux" system profile (panes = today's `DEFAULT_PANES`) if tmux is installed.

System profiles regenerate on launch based on detection (so newly-installed tools appear automatically), but never overwrite user profiles.

### `migrate.ts`

Runs once on store init, gated by `launchersSchemaVersion: 1`:

1. **Backup**: copy `~/.atrium/config.json` and any encountered `.atrium.json` into `~/.atrium/backups/pre-launcher-migration-<timestamp>/`.
2. Run detection + `seedSystemProfiles`.
3. Convert `config.defaultLaunchProfile` (old `LaunchAction[]`) → one user profile. If it matches a seeded system profile structurally, point `defaults.global` at the system one; otherwise create a user profile and use that.
4. For each wing with old-shape `wing.launchProfile`: materialize a wing-scoped user profile (named `<WingName> launcher`), rewrite `wing.launchProfile` to its id.
5. For each `.atrium.json` under known wing dirs: materialize a wing-scoped tmux user profile from its panes, set as the wing's launchProfile, then **delete the `.atrium.json` file**.
6. For each workspace with an old-shape inline `launchProfile`: same treatment, workspace-scoped.
7. Write `launchersSchemaVersion: 1`.

### `exec.ts`

Replaces `src/main/launcher.ts`. `executeProfile(profile, ctx)` iterates `actions[]` and dispatches per `action.type`. Actions run in order; **the first failure aborts the rest** and surfaces a toast naming which action failed and why.

Per-action executors lift from today's `launcher.ts`:

- `editor` ← `launchEditor`
- `terminal` ← `launchTerminalCmd` (with optional initial command)
- `tmux` ← `launchTerminalTmux`
- `command` ← new (spawn with chosen shell, no terminal window)

All spawns inject `ATRIUM_*` env vars. Tmux additionally uses `set-environment -t <session>` so panes inherit them.

Env contract:

- `ATRIUM_WORKSPACE_DIR`, `ATRIUM_WORKSPACE_ID`, `ATRIUM_WORKSPACE_NAME`
- `ATRIUM_WING_ID`, `ATRIUM_WING_NAME`
- `ATRIUM_BRANCH` (when worktree-isolated)
- `ATRIUM_CONTEXT_FILE` (path to the temp markdown context file)

The `${claude}` token in tmux panes keeps working (existing `buildClaudeCommand` logic ports over). Session-id capture (`scheduleSessionIdCapture`) ports as-is.

Delete `src/main/launcher.ts` once exec is wired up — no shim.

## Phase 3 — IPC + preload

In `src/main/ipc.ts`, add (and mirror in `window.api.launchers.*`):

- `launchers:list` → `{ profiles, globalDefault }`
- `launchers:upsert(profile)`
- `launchers:remove(id)`
- `launchers:setGlobalDefault(id)`
- `launchers:resolve(wingId, workspaceId)` → `LaunchProfile`
- `launchers:detect` → `detectLaunchTools()`

The existing launch IPC keeps its shape; its implementation calls `executeProfile(resolveForWorkspace(...))`.

## Phase 4 — Reusable `<LauncherPicker>` component

One component used by wizard, Settings global-default, wing settings, and workspace settings:

```tsx
<LauncherPicker
  scope="global" | "wing" | "workspace"
  value={profileId | null}     // null → inherit
  inheritedLabel?: string      // e.g. "global: Three-pane tmux"
  onChange={(profileId) => …}
/>
```

Per-instance behavior:

- **`scope="global"`** — no "Inherit" row (it's the root).
- **`scope="wing"`** — "Inherit (global: <name>)" is the first option.
- **`scope="workspace"`** — "Inherit from wing (<name>)" is the first option.

Built-in affordances:

- Each profile row in the dropdown shows: name, one-line description (subtext), availability badge (red dot + tooltip if a required tool is missing).
- **"+ New launcher…"** at the bottom — opens the inline profile editor in a popover; on save, assigns the new profile to the current scope.
- **"Duplicate"** button next to each user-selectable row — clones the profile, switches selection to the copy, opens the editor.

## Phase 5 — Settings UI: `LaunchersPanel.tsx`

New component, modeled on `ConnectorsPanel.tsx`. Wired in as a "Launchers" tab in `SettingsModal.tsx`.

- Header: `<LauncherPicker scope="global">` for the global default.
- One row per profile. Row shows: name, description, system badge if applicable, action-count summary ("editor + tmux"), expand chevron. Delete hidden when `isSystem` or when id matches global default. Duplicate visible everywhere.
- Expanded row — single editor used for all kinds:
  - Name field (read-only for system profiles).
  - Ordered action list. Each row: type chip, one-line summary, up/down, delete, expand.
  - Per-action expanded editors:
    - `editor` — app dropdown (detected editors badged), `withClaude` toggle when app supports it.
    - `terminal` — app dropdown (detected terminals badged), optional command field.
    - `tmux` — terminal app dropdown, row-per-pane table with up/down (no DnD). Each pane row: command, split (h/v; first row hides this), size %, focus radio (mutually exclusive). "Add pane" appends. Collapsible live preview of generated `tmux` commands.
    - `command` — shell dropdown, command textarea, collapsible help block listing the `ATRIUM_*` env vars.
  - "Add action" dropdown at bottom (one item per action type).
  - For `isSystem` profiles, all fields render read-only with a single "Duplicate to customize" button at the bottom.

## Phase 6 — Wing / Workspace override UI

- **Wing settings** — locate during implementation (likely in `SpacesSidebar.tsx` or a wing-edit modal). Add `<LauncherPicker scope="wing">`. Writes to `wing.launchProfile` via existing wing update IPC.
- **Workspace settings** — in `WorkspaceDetail.tsx`. Add `<LauncherPicker scope="workspace">`. Writes to `workspace.launchProfile`.

## Phase 7 — Wizard (`SetupWizard.tsx`)

Becomes nearly trivial. The launch-profile step is one `<LauncherPicker scope="global">` — same picker as everywhere else, with the same duplicate / new-launcher affordances. `gh` / `claude` checks stay as informational badges, never blocking.

`src/renderer/src/components/LaunchProfileEditor.tsx` gets deleted — its job is absorbed into the per-action editors inside `LauncherPicker`'s inline editor popover.

## Phase 8 — Cleanup

- Delete `src/main/launcher.ts`, `src/renderer/src/components/LaunchProfileEditor.tsx`.
- Remove old `LaunchAction` union shape (replaced), `AtriumConfig.defaultLaunchProfile`, old inline-array `Wing.launchProfile` / `Workspace.launchProfile` shapes from `types.ts`.
- README: launcher model + `ATRIUM_*` env var contract.

## Risk profile

Single PR, destructive migration, touching the launch flow end-to-end. Mitigations:

- Migration runs a backup as its first step.
- Migration is idempotent and gated by `launchersSchemaVersion`.
- Detection failures (missing apps) never crash; exec aborts the action chain and surfaces a clear toast.
- Manual test plan: fresh install (no config), upgrade from current state, launch flow per action type, wing override, workspace override, duplicate-and-customize from picker, "+ New launcher…" from picker.

## Open items resolved during implementation

- Exact location of wing-settings UI for `<LauncherPicker scope="wing">`.
- Whether system tmux profile's pane 2 keeps `focus: true` (yes — port `DEFAULT_PANES` verbatim).
- Whether `${claude}` token is exposed in `command`-action `command` fields — **no**, it's a tmux-pane affordance; command-action authors use `ATRIUM_CONTEXT_FILE`.

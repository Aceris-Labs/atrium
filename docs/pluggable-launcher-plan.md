# Pluggable Launcher Plan

## Framing

Atrium is a workspace organizer. The launcher is a pluggable utility, not a tmux UI. The current three-pane tmux setup (nvim + claude + shell) is one user's preference, not the product. This plan makes the launcher fully configurable: multiple saved `LaunchProfile` records of various kinds, with overrides at global / wing / workspace scopes, managed through a Settings UI that mirrors the Connectors pattern.

Design decisions confirmed:

1. Presets are user-editable from the UI.
2. Workspace context is exposed to launchers as `ATRIUM_*` env vars (stable contract).
3. Override hierarchy: global default → wing → workspace, all three levels.
4. Wizard becomes a soft picker (detect, present, sane default, skippable), no hard gates.
5. Tmux pane editor is a row-per-pane UI, not a JSON textarea.
6. Existing `defaultLaunchProfile` config and per-project `.atrium.json` get a migration path.

## Phase 1 — Types & data model (`src/shared/types.ts`)

```ts
type LaunchProfileKind = "editor" | "terminal" | "editor+terminal" | "tmux" | "command";

type LaunchProfile = {
  id: string;          // uuid
  name: string;        // user-editable display name
  kind: LaunchProfileKind;
  config: EditorConfig | TerminalConfig | EditorTerminalConfig | TmuxConfig | CommandConfig;
};

type LaunchScope =
  | { level: "global" }
  | { level: "wing"; wingId: string }
  | { level: "workspace"; workspaceId: string };
```

Per-kind configs:

- `EditorConfig { app }`
- `TerminalConfig { app }`
- `EditorTerminalConfig { editor, terminal }`
- `TmuxConfig { terminalApp, panes: TmuxPane[] }` (reuse existing `TmuxPane`)
- `CommandConfig { shell, command }`

## Phase 2 — Main process modules (new `src/main/launchers/`)

- **`registry.ts`** — Seeded built-in profiles created on first run: one editor profile per detected editor, one terminal profile per detected terminal, a starter tmux profile matching today's `DEFAULT_PANES`, and an empty command profile template.
- **`store.ts`** — Persist `{ profiles, defaults: { global, wings: {wingId: id|null}, workspaces: {wsId: id|null} } }` under a new `launchers` key in `~/.atrium/config.json`. API: `listProfiles`, `upsertProfile`, `removeProfile`, `setDefault(scope, id|null)`, `resolve(workspaceCtx) → LaunchProfile`.
- **`migrate.ts`** — Runs once on store init: convert existing `defaultLaunchProfile` into a seeded profile and set `defaults.global`. Walk known wing dirs for `.atrium.json`; for each, materialize a wing-scoped tmux profile from the file's pane overrides. Write a `launchersSchemaVersion: 1` marker. `.atrium.json` keeps working as a read-fallback for one release, then is removed.
- **`exec.ts`** — Refactor of current `src/main/launcher.ts`. One executor per `LaunchProfileKind`. All executors receive an `AtriumEnv` block and inject it as env vars on every spawned process, and for tmux into pane shells via `set-environment`:
  - `ATRIUM_WORKSPACE_DIR`, `ATRIUM_WORKSPACE_ID`, `ATRIUM_WORKSPACE_NAME`
  - `ATRIUM_WING_ID`, `ATRIUM_WING_NAME`
  - `ATRIUM_BRANCH` (when worktree-isolated)
  - `ATRIUM_CONTEXT_FILE` (path to the temp markdown context file)
- **`detect.ts`** — `detectLaunchTools()` returns `{ editors, terminals, tmux, shells }` with `{installed, version?}` per entry. Used by both wizard and Settings to badge availability.

Keep `src/main/launcher.ts` as a thin shim during refactor, then delete.

## Phase 3 — IPC + preload

Add handlers in `src/main/ipc.ts`, mirroring the connectors surface:

- `launchers:list` → `{ profiles, defaults }`
- `launchers:upsert(profile)`
- `launchers:remove(id)`
- `launchers:setDefault(scope, id|null)`
- `launchers:resolve(workspaceId)` → resolved profile
- `launchers:detect` → `detectLaunchTools()`
- `launchers:launch(workspaceId)` → resolves + execs (replaces today's launch IPC)

Expose under `window.api.launchers.*` in `src/preload/index.ts` with typed signatures.

## Phase 4 — Settings UI: LaunchersPanel

New `src/renderer/src/components/LaunchersPanel.tsx`, modeled on `ConnectorsPanel.tsx`:

- Header with "Add launcher" button (dropdown of kinds → seeds a new profile).
- One row per profile: name, kind badge, availability badge (e.g. red "tmux not installed"), expand chevron.
- Expanded body holds a kind-specific editor component:
  - `EditorProfileEditor` — dropdown of detected editors + name field
  - `TerminalProfileEditor` — dropdown of detected terminals + name field
  - `EditorTerminalProfileEditor` — both
  - `TmuxProfileEditor` — terminal dropdown + row-per-pane editor: command field, split direction (h/v/none), size %, focus toggle, drag-reorder (or up/down buttons), add/remove pane buttons. Collapsible live preview of generated `tmux` commands.
  - `CommandProfileEditor` — shell dropdown (zsh/bash/sh/fish), command textarea, collapsible info block listing the `ATRIUM_*` env vars
- Save / Cancel / Delete inline, like `ConnectorRow`.

Wire into `SettingsModal.tsx` as a new "Launchers" tab.

## Phase 5 — Scope override UI

Locate wing-settings UI and add a "Launcher" dropdown: `[Inherit (global default: <name>)] | <each profile>`. Locate workspace-settings UI and add the same: `[Inherit from wing] | <each profile>`. Both call `launchers:setDefault(scope, id|null)`.

## Phase 6 — Wizard

In `SetupWizard.tsx`, replace the current launch-profile step:

1. Call `launchers:detect`.
2. Show a list of suggested starter profiles built from detected tools — e.g., "Open in Cursor", "Open in VS Code", "Open in Terminal.app", "Three-pane tmux (nvim + claude + shell)" (last shown disabled with "Install tmux to enable" if not detected).
3. Pick one or skip. On finish, the seeded profile is saved and set as `defaults.global`.
4. Sane fallback if user skips: first detected editor → terminal → an empty command profile.
5. Tools step: keep `gh`/`claude` checks but as informational badges, never blocking.

## Phase 7 — Cleanup

- Remove `defaultLaunchProfile` shape from `config.json` writers (migration handles old reads).
- Remove `.atrium.json` reading once migration has run on launch (keep one release of compatibility, log a deprecation).
- Update README with the launcher model and `ATRIUM_*` env var contract.

## Sequencing — three PRs

- **PR1** — Phases 1–3 (types, store, migration, IPC, exec refactor). No UI yet; existing wizard keeps working via the migrated default. Verifiable by launching workspaces unchanged.
- **PR2** — Phases 4–5 (Settings tab + scope overrides). Users can now manage profiles.
- **PR3** — Phases 6–7 (wizard rewrite + cleanup).

## Open items to confirm during implementation

- Exact location of wing/workspace settings UIs (Phase 5).
- Whether `defaults.workspaces` lives in `config.json` or in each wing's `workspaces.json` — leaning per-wing to keep workspace data co-located; confirm against existing shape first.
- Tmux pane drag-reorder library vs. plain up/down buttons — depends on whether the project already uses a DnD library.

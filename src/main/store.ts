import {
  readFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  renameSync,
  rmSync,
} from "fs";
import { writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import type {
  Workspace,
  AtriumConfig,
  Wing,
  LaunchAction,
  Item,
  TodoItem,
  NoteItem,
} from "../shared/types";

function firstLineAndRest(text: string): { title: string; body?: string } {
  const trimmed = text.trim();
  const newlineIdx = trimmed.indexOf("\n");
  if (newlineIdx === -1) return { title: trimmed };
  return {
    title: trimmed.slice(0, newlineIdx).trim(),
    body: trimmed.slice(newlineIdx + 1).trim() || undefined,
  };
}

/** One-shot migration of legacy todos/notes into the unified Item array.
 *  Returns true if anything changed. */
function migrateToItems(target: {
  items?: Item[];
  todos?: TodoItem[];
  notes?: NoteItem[];
  createdAt?: string;
}): boolean {
  if (target.items !== undefined) return false; // already migrated
  const items: Item[] = [];
  const fallbackTime = target.createdAt ?? new Date().toISOString();
  for (const t of target.todos ?? []) {
    items.push({
      id: t.id,
      title: t.text,
      done: t.done,
      createdAt: fallbackTime,
      updatedAt: fallbackTime,
    });
  }
  for (const n of target.notes ?? []) {
    const { title, body } = firstLineAndRest(n.text);
    items.push({
      id: n.id,
      title: title || "(untitled)",
      body,
      done: false,
      createdAt: n.createdAt ?? fallbackTime,
      updatedAt: n.createdAt ?? fallbackTime,
    });
  }
  target.items = items;
  delete target.todos;
  delete target.notes;
  return true;
}

const DIR = join(homedir(), ".atrium");
const CONFIG_FILE = join(DIR, "config.json");
const WINGS_DIR = join(DIR, "wings");

// Legacy locations (pre-Wing layout) — only read for one-shot migration.
const LEGACY_WORKSPACES_FILE = join(DIR, "workspaces.json");
const LEGACY_WATCHED_FILE = join(DIR, "watched-prs.json");

const DEFAULT_LAUNCH_PROFILE: LaunchAction[] = [
  { type: "terminal-tmux", app: "ghostty" },
];

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function wingDir(id: string): string {
  return join(WINGS_DIR, id);
}

function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  ensureDir(DIR);
  await writeFile(file, JSON.stringify(data, null, 2));
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "wing"
  );
}

function newWingId(name: string): string {
  const base = slugify(name);
  const existing = new Set(listWingDirs());
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function listWingDirs(): string[] {
  if (!existsSync(WINGS_DIR)) return [];
  return readdirSync(WINGS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

// ── Migration ──────────────────────────────────────────────────────────────
// If pre-Wing files exist and no wings directory yet, fold them into a "Main"
// wing. Nondestructive: old files are renamed with a `.legacy` suffix rather
// than deleted, so the user can recover if anything goes wrong.
function runMigrationIfNeeded(): void {
  if (existsSync(WINGS_DIR) && listWingDirs().length > 0) return;

  const hasLegacyWorkspaces = existsSync(LEGACY_WORKSPACES_FILE);
  const hasLegacyWatched = existsSync(LEGACY_WATCHED_FILE);
  const hasLegacyConfig = existsSync(CONFIG_FILE);
  if (!hasLegacyWorkspaces && !hasLegacyWatched && !hasLegacyConfig) return;

  const legacyConfig = hasLegacyConfig
    ? readJson<Record<string, unknown>>(CONFIG_FILE, {})
    : {};
  const legacyRootDir = legacyConfig.rootDir as string | undefined;
  const legacyProfile = legacyConfig.launchProfile as
    | LaunchAction[]
    | undefined;

  // Only migrate if there's meaningful legacy data to move.
  const shouldMigrate =
    hasLegacyWorkspaces || hasLegacyWatched || legacyRootDir || legacyProfile;
  if (!shouldMigrate) return;

  const wingId = "main";
  const dir = wingDir(wingId);
  ensureDir(dir);

  const wing: Wing = {
    id: wingId,
    name: "Main",
    projectDir: legacyRootDir,
    launchProfile: undefined, // inherit default
    createdAt: new Date().toISOString(),
  };
  // Migration writes are best-effort fire-and-forget — this code path
  // runs at most once per installation (old → new wing layout).
  void writeJson(join(dir, "wing.json"), wing);

  if (hasLegacyWorkspaces) {
    const workspaces = readJson<Workspace[]>(LEGACY_WORKSPACES_FILE, []);
    void writeJson(join(dir, "workspaces.json"), workspaces);
    renameSync(LEGACY_WORKSPACES_FILE, LEGACY_WORKSPACES_FILE + ".legacy");
  }
  if (hasLegacyWatched) {
    const watched = readJson<WatchedPR[]>(LEGACY_WATCHED_FILE, []);
    void writeJson(join(dir, "watched-prs.json"), watched);
    renameSync(LEGACY_WATCHED_FILE, LEGACY_WATCHED_FILE + ".legacy");
  }

  const newConfig: AtriumConfig = {
    ghPath: (legacyConfig.ghPath as string) ?? "/opt/homebrew/bin/gh",
    setupComplete: (legacyConfig.setupComplete as boolean) ?? false,
    defaultLaunchProfile: legacyProfile ?? DEFAULT_LAUNCH_PROFILE,
    wingOrder: [wingId],
    activeWingId: wingId,
  };
  void writeJson(CONFIG_FILE, newConfig);
}

// ── Global config ──────────────────────────────────────────────────────────
export function getConfig(): AtriumConfig {
  ensureDir(DIR);
  runMigrationIfNeeded();

  if (!existsSync(CONFIG_FILE)) {
    return {
      ghPath: "/opt/homebrew/bin/gh",
      setupComplete: false,
      defaultLaunchProfile: DEFAULT_LAUNCH_PROFILE,
      wingOrder: [],
      activeWingId: null,
    };
  }

  const raw = readJson<Record<string, unknown>>(CONFIG_FILE, {});
  return {
    ghPath: (raw.ghPath as string) ?? "/opt/homebrew/bin/gh",
    setupComplete: (raw.setupComplete as boolean) ?? false,
    defaultLaunchProfile:
      (raw.defaultLaunchProfile as LaunchAction[]) ?? DEFAULT_LAUNCH_PROFILE,
    wingOrder: (raw.wingOrder as string[]) ?? [],
    activeWingId: (raw.activeWingId as string | null) ?? null,
  };
}

export async function setConfig(
  partial: Partial<AtriumConfig>,
): Promise<AtriumConfig> {
  const current = getConfig();
  const updated = { ...current, ...partial };
  await writeJson(CONFIG_FILE, updated);
  return updated;
}

// ── Wings ──────────────────────────────────────────────────────────────────
function migrateWingData(raw: Record<string, unknown>): Wing {
  if (raw.rootDir && !raw.projectDir) {
    raw.projectDir = raw.rootDir;
    delete raw.rootDir;
  }
  const wing = raw as unknown as Wing;
  if (migrateToItems(wing)) {
    void writeJson(join(wingDir(wing.id), "wing.json"), wing);
  }
  return wing;
}

export function listWings(): Wing[] {
  const config = getConfig();
  const order = config.wingOrder;
  const wings: Wing[] = [];
  for (const id of order) {
    const file = join(wingDir(id), "wing.json");
    if (!existsSync(file)) continue;
    const raw = readJson<Record<string, unknown>>(file, {
      id,
      name: id,
      createdAt: "",
    });
    wings.push(migrateWingData(raw));
  }
  return wings;
}

export function getWing(id: string): Wing | null {
  const file = join(wingDir(id), "wing.json");
  if (!existsSync(file)) return null;
  const raw = readJson<Record<string, unknown> | null>(file, null);
  if (!raw) return null;
  return migrateWingData(raw);
}

export async function createWing(data: {
  name: string;
  projectDir?: string;
  launchProfile?: LaunchAction[];
}): Promise<Wing> {
  ensureDir(WINGS_DIR);
  const id = newWingId(data.name);
  const dir = wingDir(id);
  ensureDir(dir);

  const wing: Wing = {
    id,
    name: data.name.trim() || "Untitled wing",
    projectDir: data.projectDir?.trim() || undefined,
    launchProfile: data.launchProfile,
    createdAt: new Date().toISOString(),
  };
  await Promise.all([
    writeJson(join(dir, "wing.json"), wing),
    writeJson(join(dir, "workspaces.json"), []),
    writeJson(join(dir, "watched-prs.json"), []),
  ]);

  const config = getConfig();
  const nextOrder = [...config.wingOrder, id];
  const nextActive = config.activeWingId ?? id;
  await setConfig({ wingOrder: nextOrder, activeWingId: nextActive });

  return wing;
}

export async function updateWing(updated: Wing): Promise<Wing> {
  const file = join(wingDir(updated.id), "wing.json");
  if (!existsSync(file)) throw new Error(`Wing not found: ${updated.id}`);
  await writeJson(file, updated);
  return updated;
}

export async function deleteWing(id: string): Promise<void> {
  const dir = wingDir(id);
  if (existsSync(dir)) rmSync(dir, { recursive: true });
  const config = getConfig();
  const newOrder = config.wingOrder.filter((wid) => wid !== id);
  const newActive =
    config.activeWingId === id ? (newOrder[0] ?? null) : config.activeWingId;
  await setConfig({ wingOrder: newOrder, activeWingId: newActive });
}

export async function reorderWings(orderedIds: string[]): Promise<void> {
  const config = getConfig();
  // Keep only ids that still have a wing dir; append any that were missed so nothing disappears.
  const existing = new Set(listWingDirs());
  const sanitized = orderedIds.filter((id) => existing.has(id));
  for (const id of config.wingOrder) {
    if (existing.has(id) && !sanitized.includes(id)) sanitized.push(id);
  }
  await setConfig({ wingOrder: sanitized });
}

export async function setActiveWing(id: string): Promise<void> {
  await setConfig({ activeWingId: id });
}

export function getEffectiveLaunchProfile(wingId: string): LaunchAction[] {
  const wing = getWing(wingId);
  const config = getConfig();
  return wing?.launchProfile ?? config.defaultLaunchProfile;
}

export function getWingProjectDir(wingId: string): string | undefined {
  return getWing(wingId)?.projectDir;
}

// ── Wing-scoped workspaces ─────────────────────────────────────────────────
function workspacesFile(wingId: string): string {
  return join(wingDir(wingId), "workspaces.json");
}

export function listWorkspaces(wingId: string): Workspace[] {
  const file = workspacesFile(wingId);
  if (!existsSync(file)) return [];
  const workspaces = readJson<Workspace[]>(file, []);
  let migrated = false;
  for (const ws of workspaces) {
    // Migrate worktreePath → directoryPath (one-shot; worktrees are no longer
    // a distinct concept — any directory the user picks is a "directoryPath").
    const legacy = ws as Workspace & { worktreePath?: string };
    if (legacy.worktreePath !== undefined) {
      if (!ws.directoryPath) ws.directoryPath = legacy.worktreePath;
      delete legacy.worktreePath;
      migrated = true;
    }
    // Migrate notes: string → NoteItem[] (intermediate step before unified items)
    if (typeof ws.notes === "string") {
      ws.notes = (ws.notes as string).trim()
        ? [
            {
              id: Date.now().toString(36),
              text: ws.notes as unknown as string,
              createdAt: ws.createdAt,
            },
          ]
        : [];
      migrated = true;
    }
    // Migrate todos+notes → unified items
    if (migrateToItems(ws)) migrated = true;
    if (!ws.links) {
      ws.links = [];
      migrated = true;
    }
    for (const link of ws.links) {
      if (!link.category) {
        const oldType = (link as any).type;
        if (oldType === "notion") {
          link.source = "notion";
          link.category = "docs";
        } else if (oldType === "linear") {
          link.source = "linear";
          link.category = "tickets";
        } else if (oldType === "github") {
          link.source = "github";
          link.category = "other";
        } else {
          link.source = link.source ?? "other";
          link.category = "other";
        }
        delete (link as any).type;
        migrated = true;
      }
    }
    // Migrate prs: number[] → { repo, number }[]. Old entries are attributed
    // to the workspace's repo; if the workspace has no repo set we can't know
    // which repo the PR is from, so we drop those entries. Users can re-link.
    if (
      Array.isArray(ws.prs) &&
      ws.prs.length > 0 &&
      typeof ws.prs[0] === "number"
    ) {
      const legacyNumbers = ws.prs as unknown as number[];
      ws.prs = ws.repo
        ? legacyNumbers.map((n) => ({ repo: ws.repo!, number: n }))
        : [];
      migrated = true;
    }
    if (!Array.isArray(ws.prs)) {
      ws.prs = [];
      migrated = true;
    }
  }
  if (migrated) void saveWorkspaces(wingId, workspaces); // best-effort one-time migration write
  return workspaces;
}

async function saveWorkspaces(
  wingId: string,
  workspaces: Workspace[],
): Promise<void> {
  ensureDir(wingDir(wingId));
  await writeJson(workspacesFile(wingId), workspaces);
}

export async function createWorkspace(
  wingId: string,
  data: Omit<Workspace, "id" | "createdAt" | "updatedAt">,
): Promise<Workspace> {
  const workspaces = listWorkspaces(wingId);
  const now = new Date().toISOString();
  const workspace: Workspace = {
    ...data,
    id: data.title
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, ""),
    items: data.items ?? [],
    createdAt: now,
    updatedAt: now,
  };
  workspaces.push(workspace);
  await saveWorkspaces(wingId, workspaces);
  return workspace;
}

export async function updateWorkspace(
  wingId: string,
  updated: Workspace,
): Promise<Workspace> {
  const workspaces = listWorkspaces(wingId);
  const idx = workspaces.findIndex((w) => w.id === updated.id);
  if (idx === -1) throw new Error(`Workspace not found: ${updated.id}`);
  workspaces[idx] = { ...updated, updatedAt: new Date().toISOString() };
  await saveWorkspaces(wingId, workspaces);
  return workspaces[idx];
}

/** Atomic bulk update: applies all changes in a single read-modify-write so
 *  callers don't race the workspaces.json file. Returns the updated records. */
export async function updateWorkspaces(
  wingId: string,
  updates: Workspace[],
): Promise<Workspace[]> {
  const workspaces = listWorkspaces(wingId);
  const now = new Date().toISOString();
  const byId = new Map(updates.map((w) => [w.id, w]));
  const result: Workspace[] = [];
  for (let i = 0; i < workspaces.length; i++) {
    const next = byId.get(workspaces[i].id);
    if (next) {
      workspaces[i] = { ...next, updatedAt: now };
      result.push(workspaces[i]);
    }
  }
  await saveWorkspaces(wingId, workspaces);
  return result;
}

/** Atomic bulk delete in a single read-modify-write. */
export async function deleteWorkspaces(
  wingId: string,
  ids: string[],
): Promise<void> {
  const idSet = new Set(ids);
  await saveWorkspaces(
    wingId,
    listWorkspaces(wingId).filter((w) => !idSet.has(w.id)),
  );
}

/** Reorders workspaces by the given id list. IDs not in the list are
 *  appended in their original relative order so nothing disappears. */
export async function reorderWorkspaces(
  wingId: string,
  orderedIds: string[],
): Promise<void> {
  const current = listWorkspaces(wingId);
  const byId = new Map(current.map((w) => [w.id, w]));
  const seen = new Set<string>();
  const ordered: Workspace[] = [];
  for (const id of orderedIds) {
    const ws = byId.get(id);
    if (ws && !seen.has(id)) {
      ordered.push(ws);
      seen.add(id);
    }
  }
  for (const ws of current) {
    if (!seen.has(ws.id)) ordered.push(ws);
  }
  await saveWorkspaces(wingId, ordered);
}

export async function deleteWorkspace(
  wingId: string,
  id: string,
): Promise<void> {
  await saveWorkspaces(
    wingId,
    listWorkspaces(wingId).filter((w) => w.id !== id),
  );
}

export async function moveWorkspace(
  fromWingId: string,
  toWingId: string,
  id: string,
): Promise<Workspace> {
  const from = listWorkspaces(fromWingId);
  const ws = from.find((w) => w.id === id);
  if (!ws) throw new Error(`Workspace not found: ${id}`);
  await saveWorkspaces(
    fromWingId,
    from.filter((w) => w.id !== id),
  );
  const to = listWorkspaces(toWingId);
  to.push(ws);
  await saveWorkspaces(toWingId, to);
  return ws;
}

// ── Wing-scoped watched PRs ────────────────────────────────────────────────
export interface WatchedPR {
  number: number;
  repo: string;
}

function watchedFile(wingId: string): string {
  return join(wingDir(wingId), "watched-prs.json");
}

export function listWatchedPRs(wingId: string): WatchedPR[] {
  return readJson<WatchedPR[]>(watchedFile(wingId), []);
}

export async function addWatchedPR(
  wingId: string,
  pr: WatchedPR,
): Promise<WatchedPR[]> {
  const list = listWatchedPRs(wingId);
  if (!list.find((p) => p.number === pr.number && p.repo === pr.repo))
    list.push(pr);
  ensureDir(wingDir(wingId));
  await writeJson(watchedFile(wingId), list);
  return list;
}

export async function removeWatchedPR(
  wingId: string,
  num: number,
): Promise<WatchedPR[]> {
  const list = listWatchedPRs(wingId).filter((p) => p.number !== num);
  ensureDir(wingDir(wingId));
  await writeJson(watchedFile(wingId), list);
  return list;
}

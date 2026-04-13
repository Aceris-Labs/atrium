import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  renameSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";
import type {
  Workspace,
  AtriumConfig,
  Wing,
  LaunchAction,
} from "../shared/types";

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

function writeJson(file: string, data: unknown): void {
  ensureDir(DIR);
  writeFileSync(file, JSON.stringify(data, null, 2));
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
    rootDir: legacyRootDir,
    launchProfile: undefined, // inherit default
    createdAt: new Date().toISOString(),
  };
  writeJson(join(dir, "wing.json"), wing);

  if (hasLegacyWorkspaces) {
    const workspaces = readJson<Workspace[]>(LEGACY_WORKSPACES_FILE, []);
    writeJson(join(dir, "workspaces.json"), workspaces);
    renameSync(LEGACY_WORKSPACES_FILE, LEGACY_WORKSPACES_FILE + ".legacy");
  }
  if (hasLegacyWatched) {
    const watched = readJson<WatchedPR[]>(LEGACY_WATCHED_FILE, []);
    writeJson(join(dir, "watched-prs.json"), watched);
    renameSync(LEGACY_WATCHED_FILE, LEGACY_WATCHED_FILE + ".legacy");
  }

  const newConfig: AtriumConfig = {
    ghPath: (legacyConfig.ghPath as string) ?? "/opt/homebrew/bin/gh",
    setupComplete: (legacyConfig.setupComplete as boolean) ?? false,
    defaultLaunchProfile: legacyProfile ?? DEFAULT_LAUNCH_PROFILE,
    wingOrder: [wingId],
    activeWingId: wingId,
  };
  writeJson(CONFIG_FILE, newConfig);
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

export function setConfig(partial: Partial<AtriumConfig>): AtriumConfig {
  const current = getConfig();
  const updated = { ...current, ...partial };
  writeJson(CONFIG_FILE, updated);
  return updated;
}

// ── Wings ──────────────────────────────────────────────────────────────────
export function listWings(): Wing[] {
  const config = getConfig();
  const order = config.wingOrder;
  const wings: Wing[] = [];
  for (const id of order) {
    const file = join(wingDir(id), "wing.json");
    if (!existsSync(file)) continue;
    wings.push(readJson<Wing>(file, { id, name: id, createdAt: "" } as Wing));
  }
  return wings;
}

export function getWing(id: string): Wing | null {
  const file = join(wingDir(id), "wing.json");
  if (!existsSync(file)) return null;
  return readJson<Wing>(file, null as unknown as Wing);
}

export function createWing(data: {
  name: string;
  rootDir?: string;
  launchProfile?: LaunchAction[];
}): Wing {
  ensureDir(WINGS_DIR);
  const id = newWingId(data.name);
  const dir = wingDir(id);
  ensureDir(dir);

  const wing: Wing = {
    id,
    name: data.name.trim() || "Untitled wing",
    rootDir: data.rootDir?.trim() || undefined,
    launchProfile: data.launchProfile,
    createdAt: new Date().toISOString(),
  };
  writeJson(join(dir, "wing.json"), wing);
  writeJson(join(dir, "workspaces.json"), []);
  writeJson(join(dir, "watched-prs.json"), []);

  const config = getConfig();
  const nextOrder = [...config.wingOrder, id];
  const nextActive = config.activeWingId ?? id;
  setConfig({ wingOrder: nextOrder, activeWingId: nextActive });

  return wing;
}

export function updateWing(updated: Wing): Wing {
  const file = join(wingDir(updated.id), "wing.json");
  if (!existsSync(file)) throw new Error(`Wing not found: ${updated.id}`);
  writeJson(file, updated);
  return updated;
}

export function reorderWings(orderedIds: string[]): void {
  const config = getConfig();
  // Keep only ids that still have a wing dir; append any that were missed so nothing disappears.
  const existing = new Set(listWingDirs());
  const sanitized = orderedIds.filter((id) => existing.has(id));
  for (const id of config.wingOrder) {
    if (existing.has(id) && !sanitized.includes(id)) sanitized.push(id);
  }
  setConfig({ wingOrder: sanitized });
}

export function setActiveWing(id: string): void {
  setConfig({ activeWingId: id });
}

export function getEffectiveLaunchProfile(wingId: string): LaunchAction[] {
  const wing = getWing(wingId);
  const config = getConfig();
  return wing?.launchProfile ?? config.defaultLaunchProfile;
}

export function getWingRootDir(wingId: string): string | undefined {
  return getWing(wingId)?.rootDir;
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
    // Migrate notes: string → NoteItem[]
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
  if (migrated) saveWorkspaces(wingId, workspaces);
  return workspaces;
}

function saveWorkspaces(wingId: string, workspaces: Workspace[]): void {
  ensureDir(wingDir(wingId));
  writeJson(workspacesFile(wingId), workspaces);
}

export function createWorkspace(
  wingId: string,
  data: Omit<Workspace, "id" | "createdAt" | "updatedAt">,
): Workspace {
  const workspaces = listWorkspaces(wingId);
  const now = new Date().toISOString();
  const workspace: Workspace = {
    ...data,
    id: data.title
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, ""),
    createdAt: now,
    updatedAt: now,
  };
  workspaces.push(workspace);
  saveWorkspaces(wingId, workspaces);
  return workspace;
}

export function updateWorkspace(wingId: string, updated: Workspace): Workspace {
  const workspaces = listWorkspaces(wingId);
  const idx = workspaces.findIndex((w) => w.id === updated.id);
  if (idx === -1) throw new Error(`Workspace not found: ${updated.id}`);
  workspaces[idx] = { ...updated, updatedAt: new Date().toISOString() };
  saveWorkspaces(wingId, workspaces);
  return workspaces[idx];
}

export function deleteWorkspace(wingId: string, id: string): void {
  saveWorkspaces(
    wingId,
    listWorkspaces(wingId).filter((w) => w.id !== id),
  );
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

export function addWatchedPR(wingId: string, pr: WatchedPR): WatchedPR[] {
  const list = listWatchedPRs(wingId);
  if (!list.find((p) => p.number === pr.number && p.repo === pr.repo))
    list.push(pr);
  ensureDir(wingDir(wingId));
  writeJson(watchedFile(wingId), list);
  return list;
}

export function removeWatchedPR(wingId: string, num: number): WatchedPR[] {
  const list = listWatchedPRs(wingId).filter((p) => p.number !== num);
  ensureDir(wingDir(wingId));
  writeJson(watchedFile(wingId), list);
  return list;
}

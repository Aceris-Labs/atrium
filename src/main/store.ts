import { readFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "fs";
import { writeFile, rename, unlink } from "fs/promises";
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

/** Like readJson but reports whether the result came from the on-disk file
 *  (`ok: true`) or the fallback (`ok: false`). Migration paths must use this
 *  to avoid persisting the fallback over an unreadable original. */
function readJsonStrict<T>(
  file: string,
  fallback: T,
): { data: T; ok: boolean } {
  if (!existsSync(file)) return { data: fallback, ok: false };
  try {
    return { data: JSON.parse(readFileSync(file, "utf-8")) as T, ok: true };
  } catch {
    return { data: fallback, ok: false };
  }
}

/** Atomic JSON write: temp file + rename. Prevents partial files on crash
 *  or interrupt — the original on-disk file is never truncated mid-write. */
async function writeJson(file: string, data: unknown): Promise<void> {
  ensureDir(DIR);
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  try {
    await writeFile(tmp, JSON.stringify(data, null, 2));
    await rename(tmp, file);
  } catch (e) {
    // Best-effort cleanup of the temp file; the original is untouched.
    await unlink(tmp).catch(() => {});
    throw e;
  }
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
// ── Global config ──────────────────────────────────────────────────────────
export function getConfig(): AtriumConfig {
  ensureDir(DIR);

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
export function listWings(): Wing[] {
  const config = getConfig();
  const wings: Wing[] = [];
  for (const id of config.wingOrder) {
    const file = join(wingDir(id), "wing.json");
    if (!existsSync(file)) continue;
    const { data, ok } = readJsonStrict<Wing | null>(file, null);
    if (!ok || !data) {
      console.error(`Wing data unreadable at ${file} — skipping.`);
      continue;
    }
    wings.push(data);
  }
  return wings;
}

export function getWing(id: string): Wing | null {
  const file = join(wingDir(id), "wing.json");
  if (!existsSync(file)) return null;
  const { data, ok } = readJsonStrict<Wing | null>(file, null);
  return ok ? data : null;
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

export function getEffectiveLaunchProfile(
  wingId: string,
  workspace?: { launchProfile?: LaunchAction[] },
): LaunchAction[] {
  const wing = getWing(wingId);
  const config = getConfig();
  return (
    workspace?.launchProfile ??
    wing?.launchProfile ??
    config.defaultLaunchProfile
  );
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
  const { data, ok } = readJsonStrict<Workspace[]>(file, []);
  if (!ok) {
    console.error(`Workspaces unreadable at ${file} — returning empty.`);
    return [];
  }
  return data;
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

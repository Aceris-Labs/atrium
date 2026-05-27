import { existsSync, readFileSync, mkdirSync } from "fs";
import { writeFile, rename, unlink } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { ATRIUM_DIR, getConfig, getWing, listWorkspaces } from "../store";
import type { LaunchProfile } from "../../shared/types";

const LAUNCHERS_FILE = join(ATRIUM_DIR, "launchers.json");

interface LaunchersFile {
  profiles: LaunchProfile[];
  globalDefault: string | null;
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

async function writeJson(file: string, data: unknown): Promise<void> {
  ensureDir(ATRIUM_DIR);
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  try {
    await writeFile(tmp, JSON.stringify(data, null, 2));
    await rename(tmp, file);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

function readFile(): LaunchersFile {
  if (!existsSync(LAUNCHERS_FILE)) {
    return { profiles: [], globalDefault: null };
  }
  try {
    return JSON.parse(readFileSync(LAUNCHERS_FILE, "utf-8")) as LaunchersFile;
  } catch {
    return { profiles: [], globalDefault: null };
  }
}

export function listProfiles(): LaunchProfile[] {
  return readFile().profiles;
}

export function getProfile(id: string): LaunchProfile | null {
  return readFile().profiles.find((p) => p.id === id) ?? null;
}

export function getGlobalDefault(): string | null {
  return readFile().globalDefault;
}

export async function writeLaunchers(data: LaunchersFile): Promise<void> {
  await writeJson(LAUNCHERS_FILE, data);
}

export function newProfileId(): string {
  return `user:${randomUUID()}`;
}

export async function upsertProfile(
  profile: LaunchProfile,
): Promise<LaunchProfile> {
  const file = readFile();
  const idx = file.profiles.findIndex((p) => p.id === profile.id);
  if (idx >= 0) {
    if (file.profiles[idx].isSystem) {
      throw new Error("System profiles are read-only — duplicate to customize");
    }
    file.profiles[idx] = profile;
  } else {
    file.profiles.push(profile);
  }
  await writeLaunchers(file);
  return profile;
}

export async function removeProfile(id: string): Promise<void> {
  const file = readFile();
  const target = file.profiles.find((p) => p.id === id);
  if (!target) return;
  if (target.isSystem) {
    throw new Error("System profiles cannot be deleted");
  }
  if (file.globalDefault === id) {
    throw new Error("Cannot delete the global default launcher");
  }
  file.profiles = file.profiles.filter((p) => p.id !== id);
  await writeLaunchers(file);
}

export async function setGlobalDefault(id: string): Promise<void> {
  const file = readFile();
  if (!file.profiles.some((p) => p.id === id)) {
    throw new Error(`Unknown launcher id: ${id}`);
  }
  file.globalDefault = id;
  await writeLaunchers(file);
}

/** Resolves the effective launcher for a workspace by walking workspace → wing → global. */
export function resolveForWorkspace(
  wingId: string,
  workspaceId: string,
): LaunchProfile {
  const file = readFile();
  const wing = getWing(wingId);
  const workspace = listWorkspaces(wingId).find((w) => w.id === workspaceId);

  const candidates = [
    workspace?.launchProfile,
    wing?.launchProfile,
    file.globalDefault ?? undefined,
  ];

  for (const id of candidates) {
    if (!id) continue;
    const found = file.profiles.find((p) => p.id === id);
    if (found) return found;
  }

  throw new Error(
    "No launcher resolved — global default is unset. Run setup or pick one in Settings → Launchers.",
  );
}

/** Used by migration to seed/replace the entire file atomically. */
export function readRawLaunchers(): LaunchersFile {
  return readFile();
}

/** Migration marker check — uses the config.launchersSchemaVersion field. */
export function migrationComplete(): boolean {
  return (getConfig().launchersSchemaVersion ?? 0) >= 1;
}

import {
  existsSync,
  readFileSync,
  mkdirSync,
  copyFileSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";
import {
  ATRIUM_DIR,
  WINGS_ROOT,
  getConfig,
  setConfig,
  listWings,
} from "../store";
import { detectTools } from "../setup";
import type { LaunchAction, LaunchProfile, TmuxPane } from "../../shared/types";
import { newProfileId, readRawLaunchers, writeLaunchers } from "./store";
import {
  DEFAULT_TMUX_PANES,
  buildSystemProfiles,
  mergeSystemProfiles,
} from "./registry";

const CONFIG_FILE = join(ATRIUM_DIR, "config.json");

/** Old LaunchAction union — used only for reading legacy data. */
type LegacyAction =
  | { type: "editor"; app: string; withClaude?: boolean }
  | { type: "terminal-tmux"; app: string; panes?: TmuxPane[] }
  | { type: "terminal-cmd"; app: string; command: string };

function resolveDir(dir?: string): string | undefined {
  if (!dir) return undefined;
  if (dir === "~") return homedir();
  if (dir.startsWith("~/")) return join(homedir(), dir.slice(2));
  return dir;
}

function translateAction(action: LegacyAction): LaunchAction {
  switch (action.type) {
    case "editor":
      return { type: "editor", app: action.app, withClaude: action.withClaude };
    case "terminal-tmux":
      return {
        type: "tmux",
        app: action.app,
        panes: action.panes ?? DEFAULT_TMUX_PANES,
      };
    case "terminal-cmd":
      return { type: "terminal", app: action.app, command: action.command };
  }
}

function translateProfile(legacy: LegacyAction[]): LaunchAction[] {
  return legacy.map(translateAction);
}

/** Returns the id of a system profile structurally equivalent to the actions, or null. */
function matchSystemProfile(
  actions: LaunchAction[],
  systemProfiles: LaunchProfile[],
): string | null {
  if (actions.length !== 1) return null;
  const a = actions[0];
  let candidateId: string | null = null;

  if (a.type === "editor" && !a.withClaude) {
    candidateId = `system:editor:${a.app}`;
  } else if (a.type === "tmux" && samePanes(a.panes, DEFAULT_TMUX_PANES)) {
    candidateId = `system:tmux:${a.app}`;
  }

  if (!candidateId) return null;
  return systemProfiles.find((p) => p.id === candidateId) ? candidateId : null;
}

function samePanes(a: TmuxPane[], b: TmuxPane[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((pa, i) => {
    const pb = b[i];
    return (
      pa.command === pb.command &&
      pa.split === pb.split &&
      pa.size === pb.size &&
      !!pa.focus === !!pb.focus
    );
  });
}

function backupFile(src: string, backupDir: string, rel: string): void {
  if (!existsSync(src)) return;
  const dest = join(backupDir, rel);
  const destDir = dest.substring(0, dest.lastIndexOf("/"));
  if (destDir && !existsSync(destDir)) mkdirSync(destDir, { recursive: true });
  copyFileSync(src, dest);
}

function readRaw<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

function isLegacyActions(value: unknown): value is LegacyAction[] {
  return (
    Array.isArray(value) &&
    value.every(
      (a) =>
        a &&
        typeof a === "object" &&
        typeof (a as { type?: unknown }).type === "string" &&
        ["editor", "terminal-tmux", "terminal-cmd"].includes(
          (a as { type: string }).type,
        ),
    )
  );
}

/**
 * One-shot migration. Safe to call on every startup; the schema-version marker
 * gates the body so re-runs are no-ops.
 */
export async function migrateLaunchers(): Promise<void> {
  const config = getConfig();
  if ((config.launchersSchemaVersion ?? 0) >= 1) return;

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = join(
    ATRIUM_DIR,
    "backups",
    `pre-launcher-migration-${timestamp}`,
  );
  mkdirSync(backupDir, { recursive: true });

  // Backup config.json and every wing.json / workspaces.json / .atrium.json we touch
  backupFile(CONFIG_FILE, backupDir, "config.json");

  const tools = await detectTools();
  const systemProfiles = buildSystemProfiles(tools);
  const userProfiles: LaunchProfile[] = [];
  let globalDefault: string | null = null;

  // 1) Convert config.defaultLaunchProfile → globalDefault
  const rawConfig = readRaw<Record<string, unknown>>(CONFIG_FILE);
  const oldDefault = rawConfig?.defaultLaunchProfile;
  if (isLegacyActions(oldDefault)) {
    const actions = translateProfile(oldDefault);
    const matched = matchSystemProfile(actions, systemProfiles);
    if (matched) {
      globalDefault = matched;
    } else {
      const profile: LaunchProfile = {
        id: newProfileId(),
        name: "Default launcher (migrated)",
        actions,
      };
      userProfiles.push(profile);
      globalDefault = profile.id;
    }
  } else {
    // Fallback: pick a sensible system profile if available
    const fallback =
      systemProfiles.find((p) => p.id === "system:tmux:ghostty") ??
      systemProfiles.find((p) => p.id.startsWith("system:tmux:")) ??
      systemProfiles.find((p) => p.id.startsWith("system:editor:")) ??
      systemProfiles[0];
    globalDefault = fallback?.id ?? null;
  }

  // 2) Walk wings — migrate wing.launchProfile and .atrium.json
  const wings = listWings();
  for (const wing of wings) {
    const wingFile = join(WINGS_ROOT, wing.id, "wing.json");
    backupFile(wingFile, backupDir, join("wings", wing.id, "wing.json"));
    const raw = readRaw<Record<string, unknown>>(wingFile);
    if (!raw) continue;

    let wingChanged = false;

    // 2a) inline wing.launchProfile (old shape: LaunchAction[])
    const inline = raw.launchProfile;
    if (isLegacyActions(inline)) {
      const actions = translateProfile(inline);
      const matched = matchSystemProfile(actions, systemProfiles);
      if (matched) {
        raw.launchProfile = matched;
      } else {
        const profile: LaunchProfile = {
          id: newProfileId(),
          name: `${wing.name} launcher`,
          actions,
        };
        userProfiles.push(profile);
        raw.launchProfile = profile.id;
      }
      wingChanged = true;
    }

    // 2b) .atrium.json in wing.projectDir — read panes, build tmux profile, delete file
    const projectDir = resolveDir(wing.projectDir);
    if (projectDir) {
      const atriumJson = join(projectDir, ".atrium.json");
      if (existsSync(atriumJson)) {
        backupFile(
          atriumJson,
          backupDir,
          join("wings", wing.id, ".atrium.json"),
        );
        try {
          const data = JSON.parse(readFileSync(atriumJson, "utf-8")) as {
            panes?: TmuxPane[];
          };
          if (Array.isArray(data.panes) && data.panes.length > 0) {
            const profile: LaunchProfile = {
              id: newProfileId(),
              name: `${wing.name} tmux (from .atrium.json)`,
              actions: [{ type: "tmux", app: "ghostty", panes: data.panes }],
            };
            userProfiles.push(profile);
            raw.launchProfile = profile.id;
            wingChanged = true;
          }
        } catch {
          // ignore malformed file
        }
        try {
          unlinkSync(atriumJson);
        } catch {
          // best-effort
        }
      }
    }

    if (wingChanged) {
      writeFileSync(wingFile, JSON.stringify(raw, null, 2));
    }

    // 2c) walk workspaces.json in this wing
    const workspacesFile = join(WINGS_ROOT, wing.id, "workspaces.json");
    backupFile(
      workspacesFile,
      backupDir,
      join("wings", wing.id, "workspaces.json"),
    );
    const rawWorkspaces = readRaw<Record<string, unknown>[]>(workspacesFile);
    if (Array.isArray(rawWorkspaces)) {
      let wsChanged = false;
      for (const ws of rawWorkspaces) {
        const wsInline = ws.launchProfile;
        if (isLegacyActions(wsInline)) {
          const actions = translateProfile(wsInline);
          const matched = matchSystemProfile(actions, systemProfiles);
          if (matched) {
            ws.launchProfile = matched;
          } else {
            const profile: LaunchProfile = {
              id: newProfileId(),
              name: `${(ws.title as string) ?? "Workspace"} launcher`,
              actions,
            };
            userProfiles.push(profile);
            ws.launchProfile = profile.id;
          }
          wsChanged = true;
        }
      }
      if (wsChanged) {
        writeFileSync(workspacesFile, JSON.stringify(rawWorkspaces, null, 2));
      }
    }
  }

  // 3) Write launchers.json + bump schema version + strip old defaultLaunchProfile
  const existing = readRawLaunchers();
  const profiles = mergeSystemProfiles(
    [...existing.profiles, ...userProfiles],
    systemProfiles,
  );
  await writeLaunchers({ profiles, globalDefault });

  // Strip the old defaultLaunchProfile field from config.json and bump version.
  // setConfig writes the AtriumConfig shape — defaultLaunchProfile is no longer
  // in the type, so it gets dropped naturally on the next setConfig call.
  await setConfig({ launchersSchemaVersion: 1 });

  console.log(
    `[launchers] Migration complete. Backed up to ${backupDir}. ` +
      `Created ${userProfiles.length} user profile(s), ${systemProfiles.length} system profile(s).`,
  );
}

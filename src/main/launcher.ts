import { spawn, spawnSync } from "child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { getEffectiveLaunchProfile, updateWorkspace } from "./store";
import type { TmuxPane, Workspace } from "../shared/types";

function resolveDir(dir?: string): string | undefined {
  if (!dir) return undefined;
  if (dir === "~") return homedir();
  if (dir.startsWith("~/")) return join(homedir(), dir.slice(2));
  return dir;
}

// GUI-launched Electron apps on macOS have a reduced PATH that typically
// doesn't include /opt/homebrew/bin. Resolve tmux to an absolute path once
// so every subsequent spawn works regardless of how the app was started.
export const TMUX_BIN: string = (() => {
  const candidates = [
    "/opt/homebrew/bin/tmux",
    "/usr/local/bin/tmux",
    "/usr/bin/tmux",
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  const which = spawnSync("/usr/bin/which", ["tmux"], { encoding: "utf-8" });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  return "tmux";
})();

function tmux(args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(TMUX_BIN, args, { encoding: "utf-8" });
}

const TERMINAL_BINS: Record<string, string> = {
  ghostty: "/Applications/Ghostty.app/Contents/MacOS/ghostty",
  iterm: "iTerm",
  terminal: "Terminal",
  warp: "Warp",
};

const EDITOR_BINS: Record<string, string[]> = {
  cursor: ["cursor"],
  code: ["code"],
};

export function launchWorkspace(wingId: string, workspace: Workspace): string {
  const launchProfile = getEffectiveLaunchProfile(wingId);
  const sessionName = workspace.tmuxSession ?? workspace.id;

  const dir = resolveDir(workspace.directoryPath);

  // Snapshot existing Claude session ids before launch so we can detect
  // the new one that gets created and persist it onto the workspace.
  const existingIds = dir ? listJsonlSessionIds(dir) : new Set<string>();

  for (const action of launchProfile) {
    switch (action.type) {
      case "editor":
        launchEditor(action.app, dir);
        break;
      case "terminal-tmux":
        launchTerminalTmux(
          action.app,
          sessionName,
          workspace,
          dir,
          action.panes,
        );
        break;
      case "terminal-cmd":
        launchTerminalCmd(action.app, action.command, dir);
        break;
    }
  }

  // Only capture a new session id on the first launch (no id associated yet).
  if (dir && !workspace.claudeSessionId) {
    scheduleSessionIdCapture(wingId, workspace, dir, existingIds);
  }

  return sessionName;
}

function launchEditor(app: string, directoryPath?: string): void {
  if (!directoryPath) return;
  const bins = EDITOR_BINS[app] ?? [app];
  spawn(bins[0], ["--new-window", directoryPath], {
    detached: true,
    stdio: "ignore",
  }).unref();
}

const DEFAULT_PANES: TmuxPane[] = [
  { command: "nvim" },
  { split: "h", size: 40, command: "${claude}", focus: true },
  { split: "v" },
];

function readProjectPanes(dir: string): TmuxPane[] | undefined {
  const configPath = join(dir, ".atrium.json");
  if (!existsSync(configPath)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8")) as Record<
      string,
      unknown
    >;
    if (Array.isArray(raw.panes)) return raw.panes as TmuxPane[];
  } catch {}
  return undefined;
}

function buildPanes(
  actionPanes: TmuxPane[] | undefined,
  workspace: Workspace,
  dir: string,
): TmuxPane[] {
  const raw = readProjectPanes(dir) ?? actionPanes ?? DEFAULT_PANES;
  const claudeCmd = buildClaudeCommand(workspace, dir);
  return raw.map((p) => ({
    ...p,
    command: p.command === "${claude}" ? claudeCmd : p.command,
  }));
}

function launchTerminalTmux(
  app: string,
  sessionName: string,
  workspace: Workspace,
  dir: string | undefined,
  actionPanes?: TmuxPane[],
): void {
  if (!dir) return;

  // If a session exists but its starting directory doesn't match the
  // workspace dir, it was created at the wrong cwd (e.g. `/`) and we can't
  // fix that on an existing session — kill it so we recreate cleanly.
  const existingPath = getSessionPath(sessionName);
  if (existingPath !== null && existingPath !== stripTrailingSlash(dir)) {
    tmux(["kill-session", "-t", sessionName]);
  }

  if (!isTmuxSessionRunning(sessionName)) {
    const s = sessionName;
    const panes = buildPanes(actionPanes, workspace, dir);

    tmux(["new-session", "-d", "-s", s, "-c", dir]);
    if (panes[0]?.command) {
      tmux(["send-keys", "-t", s, panes[0].command, "Enter"]);
    }

    let focusIndex: number | undefined = panes[0]?.focus ? 0 : undefined;

    for (let i = 1; i < panes.length; i++) {
      const pane = panes[i];
      const splitArgs = [
        "split-window",
        pane.split === "v" ? "-v" : "-h",
        "-t",
        s,
      ];
      if (pane.size !== undefined) splitArgs.push("-p", String(pane.size));
      splitArgs.push("-c", dir);
      tmux(splitArgs);
      if (pane.command) {
        tmux(["send-keys", "-t", s, pane.command, "Enter"]);
      }
      if (pane.focus) focusIndex = i;
    }

    if (focusIndex !== undefined) {
      tmux(["select-pane", "-t", `${s}:0.${focusIndex}`]);
    }
  }

  // Try switch-client first (reuse an existing tmux client), fall back to
  // opening a new terminal window. Only activate the app when reusing an
  // existing window — when spawning a new one, the new window will come to
  // front on its own. Calling activateApp before the window exists just
  // foregrounds whatever window was already open.
  const switched = tmux(["switch-client", "-t", sessionName]);
  if (switched.status !== 0) {
    openTerminalWithTmux(app, sessionName, dir);
  } else {
    activateApp(app);
  }
}

// Returns the session's starting directory (tmux `session_path`, which
// is set by `-c` at new-session time and never changes). Null if the
// session doesn't exist. Trailing slashes are stripped so callers can
// compare against `dir` with stripTrailingSlash.
function getSessionPath(sessionName: string): string | null {
  const result = tmux([
    "display-message",
    "-p",
    "-t",
    sessionName,
    "#{session_path}",
  ]);
  if (result.status !== 0) return null;
  const path = (result.stdout ?? "").trim();
  if (!path) return null;
  return stripTrailingSlash(path);
}

function stripTrailingSlash(p: string): string {
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
}

function launchTerminalCmd(
  app: string,
  command: string,
  directoryPath?: string,
): void {
  const dir = directoryPath ?? "~";

  switch (app) {
    case "ghostty":
      spawn(
        TERMINAL_BINS.ghostty,
        ["-e", "bash", "-c", `cd ${dir} && ${command}`],
        {
          detached: true,
          stdio: "ignore",
        },
      ).unref();
      break;
    case "warp":
    case "iterm":
    case "terminal": {
      const appName = TERMINAL_BINS[app];
      const script =
        app === "iterm"
          ? `tell application "${appName}" to create window with default profile command "cd ${dir} && ${command}"`
          : `tell application "${appName}" to do script "cd ${dir} && ${command}"`;
      spawn("osascript", ["-e", script], {
        detached: true,
        stdio: "ignore",
      }).unref();
      break;
    }
  }

  activateApp(app);
}

function openTerminalWithTmux(
  app: string,
  sessionName: string,
  dir: string,
): void {
  // `new-session -A` attaches if the session exists, otherwise creates it
  // with `-c dir`. This makes the fallback safe even if the main-process
  // pre-create silently failed (e.g. tmux not on PATH).
  const attachCmd = `${TMUX_BIN} new-session -A -s ${sessionName} -c ${JSON.stringify(dir)}`;
  switch (app) {
    case "ghostty":
      spawn(
        TERMINAL_BINS.ghostty,
        [`--working-directory=${dir}`, "-e", "sh", "-c", attachCmd],
        { cwd: dir, detached: true, stdio: "ignore" },
      ).unref();
      break;
    case "iterm":
      spawn(
        "osascript",
        [
          "-e",
          `tell application "iTerm" to create window with default profile command "${attachCmd}"`,
        ],
        { detached: true, stdio: "ignore" },
      ).unref();
      break;
    case "warp":
      spawn(
        "osascript",
        ["-e", `tell application "Warp" to do script "${attachCmd}"`],
        { detached: true, stdio: "ignore" },
      ).unref();
      break;
    case "terminal":
      spawn(
        "osascript",
        ["-e", `tell application "Terminal" to do script "${attachCmd}"`],
        { detached: true, stdio: "ignore" },
      ).unref();
      break;
  }
}

function activateApp(app: string): void {
  const names: Record<string, string> = {
    ghostty: "Ghostty",
    iterm: "iTerm",
    terminal: "Terminal",
    warp: "Warp",
    cursor: "Cursor",
    code: "Visual Studio Code",
  };
  const name = names[app];
  if (name) {
    spawn("osascript", ["-e", `tell application "${name}" to activate`], {
      detached: true,
      stdio: "ignore",
    }).unref();
  }
}

function buildClaudeCommand(workspace: Workspace, dir: string): string {
  const lines: string[] = [`# Atrium Context: ${workspace.title}`, ""];
  const todos = workspace.todos ?? [];
  const pending = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);
  if (todos.length > 0) {
    lines.push("## Todos");
    pending.forEach((t) => lines.push(`- [ ] ${t.text}`));
    done.forEach((t) => lines.push(`- [x] ${t.text}`));
    lines.push("");
  }
  const noteItems = Array.isArray(workspace.notes) ? workspace.notes : [];
  if (noteItems.length > 0) {
    lines.push("## Notes");
    noteItems.forEach((n: any) => lines.push(`- ${n.text}`));
    lines.push("");
  }
  if (workspace.prs.length > 0) {
    lines.push("## Linked PRs");
    workspace.prs.forEach((p) => lines.push(`- ${p.repo}#${p.number}`));
    lines.push("");
  }
  if (workspace.branch) lines.push("## Branch", workspace.branch, "");
  const contextPath = `/tmp/atrium-context-${workspace.id}.md`;
  writeFileSync(contextPath, lines.join("\n"), "utf-8");
  const id = workspace.claudeSessionId;
  const resumeFlag = id ? `--resume ${id} ` : "";
  return `claude ${resumeFlag}--append-system-prompt "$(cat ${contextPath})"`;
}

// Returns the ~/.claude/projects/<slug> directory for a given working dir.
// Claude derives the slug by replacing all `/` in the absolute cwd with `-`.
function claudeProjectDir(dir: string): string {
  const resolved = resolveDir(dir) ?? dir;
  const slug = stripTrailingSlash(resolved).replace(/\//g, "-");
  return join(homedir(), ".claude", "projects", slug);
}

// Returns the set of session UUIDs (jsonl basenames without extension)
// currently present in the Claude project dir for the given working dir.
function listJsonlSessionIds(dir: string): Set<string> {
  const projectDir = claudeProjectDir(dir);
  if (!existsSync(projectDir)) return new Set();
  try {
    return new Set(
      readdirSync(projectDir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => f.slice(0, -".jsonl".length)),
    );
  } catch {
    return new Set();
  }
}

// After a new Claude session is launched, poll the project dir until a new
// .jsonl file appears (i.e. the session id we don't yet know). Persists
// the id onto the workspace so future launches can --resume it explicitly.
// Gives up after 60s if nothing appears.
function scheduleSessionIdCapture(
  wingId: string,
  workspace: Workspace,
  dir: string,
  existingIds: Set<string>,
): void {
  const INTERVAL_MS = 1_000;
  const TIMEOUT_MS = 60_000;
  let elapsed = 0;

  const timer = setInterval(() => {
    elapsed += INTERVAL_MS;
    const current = listJsonlSessionIds(dir);
    for (const id of current) {
      if (!existingIds.has(id)) {
        clearInterval(timer);
        void updateWorkspace(wingId, { ...workspace, claudeSessionId: id });
        return;
      }
    }
    if (elapsed >= TIMEOUT_MS) {
      clearInterval(timer);
    }
  }, INTERVAL_MS);
}

export function stopSession(sessionName: string): void {
  if (isTmuxSessionRunning(sessionName)) {
    tmux(["kill-session", "-t", sessionName]);
  }
}

export function isTmuxSessionRunning(session: string): boolean {
  return tmux(["has-session", "-t", session]).status === 0;
}

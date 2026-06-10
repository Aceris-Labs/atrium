import { spawn, spawnSync, execFile } from "child_process";
import { promisify } from "util";
import { existsSync, readdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { shell } from "electron";
import { buildWorkspaceContextMarkdown } from "../context";
import { getWing, updateWorkspace } from "../store";
import { resolveForWorkspace } from "./store";
import type {
  LaunchAction,
  LaunchProfile,
  TmuxPane,
  Workspace,
} from "../../shared/types";

const execFileP = promisify(execFile);

const CHILD_TIMEOUT_MS = 5_000;

interface ChildResult {
  status: number;
  stdout: string;
  stderr: string;
}

async function run(bin: string, args: string[]): Promise<ChildResult> {
  try {
    const { stdout, stderr } = await execFileP(bin, args, {
      encoding: "utf-8",
      timeout: CHILD_TIMEOUT_MS,
    });
    return { status: 0, stdout, stderr };
  } catch (e) {
    const err = e as NodeJS.ErrnoException & {
      code?: number | string;
      stdout?: string;
      stderr?: string;
      killed?: boolean;
      signal?: string;
    };
    if (err.killed && err.signal === "SIGTERM") {
      throw new Error(
        `${bin} ${args.join(" ")} timed out after ${CHILD_TIMEOUT_MS}ms`,
      );
    }
    return {
      status: typeof err.code === "number" ? err.code : 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

function resolveDir(dir?: string): string | undefined {
  if (!dir) return undefined;
  if (dir === "~") return homedir();
  if (dir.startsWith("~/")) return join(homedir(), dir.slice(2));
  return dir;
}

// GUI-launched Electron apps on macOS have a reduced PATH; resolve tmux once.
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

function tmuxCmd(args: string[]): Promise<ChildResult> {
  return run(TMUX_BIN, args);
}

const TERMINAL_BINS: Record<string, string> = {
  ghostty: "/Applications/Ghostty.app/Contents/MacOS/ghostty",
  iterm: "iTerm",
  terminal: "Terminal",
  warp: "Warp",
};

const EDITOR_APP_NAMES: Record<string, string> = {
  cursor: "Cursor",
  code: "Visual Studio Code",
};

const TERMINAL_APP_NAMES: Record<string, string> = {
  ghostty: "Ghostty",
  iterm: "iTerm",
  terminal: "Terminal",
  warp: "Warp",
};

interface ExecContext {
  wingId: string;
  workspace: Workspace;
  /** Effective working directory for the launch (worktree.path ?? wing.projectDir). */
  dir: string | undefined;
  /** ATRIUM_* env vars to inject into every spawned process. */
  env: Record<string, string>;
  /** Path to the temp markdown context file. */
  contextFilePath: string;
  sessionName: string;
}

function buildContext(wingId: string, workspace: Workspace): ExecContext {
  const wing = getWing(wingId);
  const sessionName = workspace.tmuxSession ?? workspace.id;
  const dir = resolveDir(workspace.worktree?.path ?? wing?.projectDir);

  const contextMd = buildWorkspaceContextMarkdown(
    workspace,
    wing?.name ?? wingId,
    wingId,
  );
  const contextFilePath = `/tmp/atrium-context-${workspace.id}.md`;
  writeFileSync(contextFilePath, contextMd, "utf-8");

  const env: Record<string, string> = {
    ATRIUM_WORKSPACE_ID: workspace.id,
    ATRIUM_WORKSPACE_NAME: workspace.title,
    ATRIUM_WING_ID: wingId,
    ATRIUM_WING_NAME: wing?.name ?? wingId,
    ATRIUM_CONTEXT_FILE: contextFilePath,
  };
  if (dir) env.ATRIUM_WORKSPACE_DIR = dir;
  if (workspace.worktree && workspace.branch) {
    env.ATRIUM_BRANCH = workspace.branch;
  }

  return { wingId, workspace, dir, env, contextFilePath, sessionName };
}

function cleanParentEnv(): Record<string, string | undefined> {
  // Strip Electron-host and Node-debugger vars that would break spawned
  // Electron apps (Cursor, VS Code, Claude CLI). ELECTRON_RUN_AS_NODE makes
  // the child run as headless Node; the others leak debugger/inspector
  // state into the child renderer and crash it (exit code 5).
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("ELECTRON_")) continue;
    if (k.startsWith("VSCODE_")) continue;
    if (k.startsWith("NODE_INSPECTOR_")) continue;
    if (k === "NODE_OPTIONS") continue;
    out[k] = v;
  }
  return out;
}

function spawnDetached(
  bin: string,
  args: string[],
  env: Record<string, string>,
  cwd?: string,
): void {
  spawn(bin, args, {
    detached: true,
    stdio: "ignore",
    cwd,
    env: { ...cleanParentEnv(), ...env },
  }).unref();
}

function activateApp(appKey: string): void {
  const name = EDITOR_APP_NAMES[appKey] ?? TERMINAL_APP_NAMES[appKey];
  if (!name) return;
  spawn("osascript", ["-e", `tell application "${name}" to activate`], {
    detached: true,
    stdio: "ignore",
  }).unref();
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildEnvExportCommands(env: Record<string, string>): string[] {
  return Object.entries(env).map(
    ([key, value]) => `export ${key}=${shellSingleQuote(value)}`,
  );
}

function warpNewWindowUri(dir: string): string {
  return `warp://action/new_window?path=${encodeURIComponent(dir)}`;
}

function openWarpWindow(
  dir: string,
  env: Record<string, string>,
  command?: string,
): void {
  spawnDetached("open", ["-u", warpNewWindowUri(dir)], env, dir);

  const startupCommand = [...buildEnvExportCommands(env), command]
    .filter((cmd): cmd is string => Boolean(cmd))
    .join(" && ");
  if (!startupCommand) return;

  setTimeout(() => {
    spawnDetached(
      "osascript",
      [
        "-e",
        `tell application "Warp" to do script ${JSON.stringify(startupCommand)}`,
      ],
      env,
      dir,
    );
  }, 750);
}

// ── Action runners ───────────────────────────────────────────────────────────

async function runEditorAction(
  action: Extract<LaunchAction, { type: "editor" }>,
  ctx: ExecContext,
): Promise<void> {
  if (!ctx.dir) {
    throw new Error("editor action requires a workspace directory");
  }
  const bin = action.app; // `cursor`, `code`, etc. on PATH
  spawnDetached(bin, ["--new-window", ctx.dir], ctx.env, ctx.dir);

  if (action.app === "code" && action.withClaude) {
    const prompt = `Workspace context for this session:\n\n${
      ctx.env.ATRIUM_CONTEXT_FILE ? `(see ${ctx.env.ATRIUM_CONTEXT_FILE})` : ""
    }`;
    const uri = `vscode://anthropic.claude-code/open?prompt=${encodeURIComponent(prompt)}`;
    void shell.openExternal(uri);
  }
}

async function runTerminalAction(
  action: Extract<LaunchAction, { type: "terminal" }>,
  ctx: ExecContext,
): Promise<void> {
  if (!ctx.dir) {
    throw new Error("terminal action requires a workspace directory");
  }
  const command = action.command;
  const cdPart = `cd ${JSON.stringify(ctx.dir)}`;
  const fullCommand = command ? `${cdPart} && ${command}` : cdPart;

  switch (action.app) {
    case "ghostty":
      spawnDetached(
        TERMINAL_BINS.ghostty,
        ["-e", "bash", "-c", fullCommand],
        ctx.env,
        ctx.dir,
      );
      break;
    case "warp":
      openWarpWindow(ctx.dir, ctx.env, command);
      break;
    case "terminal":
    case "iterm": {
      const appName = TERMINAL_APP_NAMES[action.app];
      const script =
        action.app === "iterm"
          ? `tell application "${appName}" to create window with default profile command "${fullCommand}"`
          : `tell application "${appName}" to do script "${fullCommand}"`;
      spawnDetached("osascript", ["-e", script], ctx.env);
      break;
    }
    default:
      throw new Error(`Unsupported terminal app: ${action.app}`);
  }

  activateApp(action.app);
}

async function runTmuxAction(
  action: Extract<LaunchAction, { type: "tmux" }>,
  ctx: ExecContext,
): Promise<void> {
  if (!ctx.dir) {
    throw new Error("tmux action requires a workspace directory");
  }
  const s = ctx.sessionName;

  // If a session exists but its starting dir doesn't match, recreate it.
  const existingPath = await getSessionPath(s);
  if (existingPath !== null && existingPath !== stripTrailingSlash(ctx.dir)) {
    await tmuxCmd(["kill-session", "-t", s]);
  }

  if (!(await isTmuxSessionRunning(s))) {
    const panes = expandPaneCommands(action.panes, ctx);

    await tmuxCmd(["new-session", "-d", "-s", s, "-c", ctx.dir]);

    // Propagate ATRIUM_* env vars to panes via tmux's session environment.
    for (const [k, v] of Object.entries(ctx.env)) {
      await tmuxCmd(["set-environment", "-t", s, k, v]);
    }

    if (panes[0]?.command) {
      await tmuxCmd(["send-keys", "-t", s, panes[0].command, "Enter"]);
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
      splitArgs.push("-c", ctx.dir);
      await tmuxCmd(splitArgs);
      if (pane.command) {
        await tmuxCmd(["send-keys", "-t", s, pane.command, "Enter"]);
      }
      if (pane.focus) focusIndex = i;
    }

    if (focusIndex !== undefined) {
      await tmuxCmd(["select-pane", "-t", `${s}:0.${focusIndex}`]);
    }
  }

  // switch-client first; fall back to opening a new terminal window.
  const switched = await tmuxCmd(["switch-client", "-t", s]);
  if (switched.status !== 0) {
    openTerminalWithTmux(action.app, s, ctx.dir, ctx.env);
  } else {
    activateApp(action.app);
  }
}

async function runCommandAction(
  action: Extract<LaunchAction, { type: "command" }>,
  ctx: ExecContext,
): Promise<void> {
  const cwd = ctx.dir;
  spawn(action.shell, ["-c", action.command], {
    detached: true,
    stdio: "ignore",
    cwd,
    env: { ...cleanParentEnv(), ...ctx.env },
  }).unref();
}

function expandPaneCommands(panes: TmuxPane[], ctx: ExecContext): TmuxPane[] {
  const claudeCmd = buildClaudeCommand(ctx);
  return panes.map((p) => ({
    ...p,
    command: p.command === "${claude}" ? claudeCmd : p.command,
  }));
}

function buildClaudeCommand(ctx: ExecContext): string {
  const id = ctx.workspace.claudeSessionId;
  const resumeFlag = id ? `--resume ${id} ` : "";
  return `claude ${resumeFlag}--append-system-prompt "$(cat ${ctx.contextFilePath})"`;
}

// ── Tmux helpers ─────────────────────────────────────────────────────────────

async function getSessionPath(sessionName: string): Promise<string | null> {
  const result = await tmuxCmd([
    "display-message",
    "-p",
    "-t",
    sessionName,
    "#{session_path}",
  ]);
  if (result.status !== 0) return null;
  const path = result.stdout.trim();
  if (!path) return null;
  return stripTrailingSlash(path);
}

function stripTrailingSlash(p: string): string {
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
}

function openTerminalWithTmux(
  app: string,
  sessionName: string,
  dir: string,
  env: Record<string, string>,
): void {
  const attachCmd = `${TMUX_BIN} new-session -A -s ${sessionName} -c ${JSON.stringify(dir)}`;
  switch (app) {
    case "ghostty":
      spawn(
        TERMINAL_BINS.ghostty,
        [`--working-directory=${dir}`, "-e", "sh", "-c", attachCmd],
        {
          cwd: dir,
          detached: true,
          stdio: "ignore",
          env: { ...cleanParentEnv(), ...env },
        },
      ).unref();
      break;
    case "iterm":
      spawnDetached(
        "osascript",
        [
          "-e",
          `tell application "iTerm" to create window with default profile command "${attachCmd}"`,
        ],
        env,
      );
      break;
    case "warp":
      openWarpWindow(dir, env, attachCmd);
      break;
    case "terminal":
      spawnDetached(
        "osascript",
        ["-e", `tell application "Terminal" to do script "${attachCmd}"`],
        env,
      );
      break;
  }
}

export async function isTmuxSessionRunning(session: string): Promise<boolean> {
  return (await tmuxCmd(["has-session", "-t", session])).status === 0;
}

export async function stopSession(sessionName: string): Promise<void> {
  if (await isTmuxSessionRunning(sessionName)) {
    await tmuxCmd(["kill-session", "-t", sessionName]);
  }
}

// ── Claude session-id capture (unchanged behavior) ───────────────────────────

function claudeProjectDir(dir: string): string {
  const resolved = resolveDir(dir) ?? dir;
  const slug = stripTrailingSlash(resolved).replace(/\//g, "-");
  return join(homedir(), ".claude", "projects", slug);
}

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
    if (elapsed >= TIMEOUT_MS) clearInterval(timer);
  }, INTERVAL_MS);
}

// ── Entrypoint ───────────────────────────────────────────────────────────────

/**
 * Executes a profile's actions in order. The first failure aborts the rest —
 * the thrown error is re-thrown with action context so callers can surface it
 * in a toast. Returns the tmux session name (or workspace id as fallback) so
 * the renderer can track it on the workspace record.
 */
export async function executeProfile(
  profile: LaunchProfile,
  ctx: ExecContext,
): Promise<string> {
  for (let i = 0; i < profile.actions.length; i++) {
    const action = profile.actions[i];
    try {
      switch (action.type) {
        case "editor":
          await runEditorAction(action, ctx);
          break;
        case "terminal":
          await runTerminalAction(action, ctx);
          break;
        case "tmux":
          await runTmuxAction(action, ctx);
          break;
        case "command":
          await runCommandAction(action, ctx);
          break;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Launcher "${profile.name}" failed on action ${i + 1} (${action.type}): ${msg}`,
      );
    }
  }
  return ctx.sessionName;
}

export async function launchWorkspace(
  wingId: string,
  workspace: Workspace,
  launchProfileOverride?: string,
): Promise<string> {
  const profile = resolveForWorkspace(
    wingId,
    workspace.id,
    launchProfileOverride,
  );
  const ctx = buildContext(wingId, workspace);
  const existingIds = ctx.dir
    ? listJsonlSessionIds(ctx.dir)
    : new Set<string>();
  await executeProfile(profile, ctx);

  if (ctx.dir && !workspace.claudeSessionId) {
    scheduleSessionIdCapture(wingId, workspace, ctx.dir, existingIds);
  }

  return ctx.sessionName;
}

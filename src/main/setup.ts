import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import type { DetectedTools, ToolStatus } from "../shared/types";

const execFileP = promisify(execFile);

const GH_PATHS = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh"];

const EDITOR_APPS: Record<string, string[]> = {
  cursor: [
    "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
    "/usr/local/bin/cursor",
  ],
  code: [
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
    "/usr/local/bin/code",
  ],
};

const TERMINAL_APPS: Record<string, string[]> = {
  ghostty: ["/Applications/Ghostty.app/Contents/MacOS/ghostty"],
  iterm: ["/Applications/iTerm.app/Contents/MacOS/iTerm2"],
  terminal: [
    "/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal",
  ],
  warp: ["/Applications/Warp.app/Contents/MacOS/stable"],
};

function findBinary(paths: string[]): string | undefined {
  return paths.find((p) => existsSync(p));
}

async function whichBinary(name: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileP("/usr/bin/which", [name]);
    const trimmed = stdout.trim();
    return trimmed || undefined;
  } catch {
    return undefined;
  }
}

async function validateGh(): Promise<ToolStatus> {
  const path = findBinary(GH_PATHS) ?? (await whichBinary("gh"));
  if (!path) return { installed: false };

  try {
    const { stdout, stderr } = await execFileP(path, ["auth", "status"]);
    const combined = stdout + stderr;
    const usernameMatch =
      combined.match(/Logged in to github\.com.*?account\s+(\S+)/i) ??
      combined.match(/(\S+)\s+\(/);
    return {
      installed: true,
      path,
      authenticated: true,
      username: usernameMatch?.[1],
    };
  } catch (e) {
    // Non-zero exit (not authenticated) still includes useful stdout/stderr.
    const err = e as { stdout?: string; stderr?: string };
    const combined = (err.stdout ?? "") + (err.stderr ?? "");
    const usernameMatch =
      combined.match(/Logged in to github\.com.*?account\s+(\S+)/i) ??
      combined.match(/(\S+)\s+\(/);
    return {
      installed: true,
      path,
      authenticated: false,
      username: usernameMatch?.[1],
    };
  }
}

async function validateClaude(): Promise<ToolStatus> {
  const path = await whichBinary("claude");
  if (!path) return { installed: false };

  try {
    const { stdout } = await execFileP(path, ["--version"]);
    return { installed: true, path, version: stdout.trim() || undefined };
  } catch {
    return { installed: true, path };
  }
}

async function validateEditor(name: string): Promise<ToolStatus> {
  const paths = EDITOR_APPS[name] ?? [];
  const path = findBinary(paths) ?? (await whichBinary(name));
  if (!path) return { installed: false };
  return { installed: true, path };
}

function validateTerminal(name: string): ToolStatus {
  const paths = TERMINAL_APPS[name] ?? [];
  const path = findBinary(paths);
  if (!path) return { installed: false };
  return { installed: true, path };
}

let cachedTools: DetectedTools | null = null;
let inFlight: Promise<DetectedTools> | null = null;

export async function detectTools(force = false): Promise<DetectedTools> {
  if (cachedTools && !force) return cachedTools;
  if (inFlight && !force) return inFlight;

  inFlight = (async () => {
    const [gh, claude, cursor, code] = await Promise.all([
      validateGh(),
      validateClaude(),
      validateEditor("cursor"),
      validateEditor("code"),
    ]);
    const tools: DetectedTools = {
      gh,
      claude,
      editors: { cursor, code },
      terminals: {
        ghostty: validateTerminal("ghostty"),
        iterm: validateTerminal("iterm"),
        terminal: validateTerminal("terminal"),
        warp: validateTerminal("warp"),
      },
    };
    cachedTools = tools;
    return tools;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

export function clearToolsCache(): void {
  cachedTools = null;
}

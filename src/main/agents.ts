import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import type { AgentSessionInfo } from "../shared/types";
import { TMUX_BIN } from "./launcher"; // used only by listAvailableSessions

const execFileAsync = promisify(execFile);

export type AgentStatus = "working" | "needs-input" | "idle" | "no-session";

const META_TYPES = new Set([
  "file-history-snapshot",
  "attachment",
  "last-prompt",
  "permission-mode",
  "model",
  "session",
]);

const NEEDS_INPUT_THRESHOLD_MS = 8_000;

function claudeProjectDir(cwd: string): string {
  const resolved =
    cwd === "~"
      ? homedir()
      : cwd.startsWith("~/")
        ? join(homedir(), cwd.slice(2))
        : cwd;
  const slug = resolved.replace(/\/+$/, "").replace(/\//g, "-");
  return join(homedir(), ".claude", "projects", slug);
}

interface JsonlEvent {
  type: string;
  message?: {
    role?: string;
    stop_reason?: string;
    content?: Array<{ type: string; tool_use_id?: string; id?: string }>;
  };
  timestamp?: string;
}

function deriveStatus(lines: string[]): AgentStatus {
  const events: JsonlEvent[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as JsonlEvent);
    } catch {
      // skip malformed lines
    }
  }

  // Find index of the last non-meta assistant event
  let lastAsstIdx = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (!META_TYPES.has(events[i].type) && events[i].type === "assistant") {
      lastAsstIdx = i;
      break;
    }
  }

  // Scan forward from that point to collect tool results and any new user text
  let hasUserTextAfter = false;
  const toolResultIds = new Set<string>();
  for (let i = lastAsstIdx + 1; i < events.length; i++) {
    const e = events[i];
    if (META_TYPES.has(e.type)) continue;
    if (e.type === "user" && e.message?.role === "user") {
      for (const c of e.message.content ?? []) {
        if (c.type === "tool_result" && c.tool_use_id) {
          toolResultIds.add(c.tool_use_id);
        } else if (c.type === "text") {
          hasUserTextAfter = true;
        }
      }
    }
  }

  if (lastAsstIdx === -1) {
    // No assistant turn yet — fresh session with a user prompt, or empty file
    return hasUserTextAfter ? "working" : "no-session";
  }

  const lastAsst = events[lastAsstIdx];
  const stopReason = lastAsst.message?.stop_reason;

  if (stopReason === "end_turn" || stopReason === "stop_sequence") {
    // Clean turn end — working only if user has sent a new prompt since
    return hasUserTextAfter ? "working" : "idle";
  }

  if (stopReason === "tool_use") {
    const pendingIds = (lastAsst.message?.content ?? [])
      .filter((c) => c.type === "tool_use" && c.id)
      .map((c) => c.id!);

    if (
      pendingIds.length > 0 &&
      pendingIds.every((id) => toolResultIds.has(id))
    ) {
      // All tools have returned; Claude's next assistant event is incoming
      return "working";
    }

    // Tool outstanding — use elapsed time to distinguish running vs. awaiting permission
    const asstTime = lastAsst.timestamp
      ? new Date(lastAsst.timestamp).getTime()
      : Date.now();
    return Date.now() - asstTime >= NEEDS_INPUT_THRESHOLD_MS
      ? "needs-input"
      : "working";
  }

  return "idle";
}

async function readJsonlStatus(jsonlPath: string): Promise<AgentStatus> {
  try {
    const text = await readFile(jsonlPath, "utf-8");
    if (!text.trim()) return "no-session";
    const lines = text.split("\n");
    // Last 200 lines is more than enough for recent turn context
    const usable = lines.length > 200 ? lines.slice(-200) : lines;
    return deriveStatus(usable);
  } catch {
    return "no-session";
  }
}

export async function getAgentStatuses(
  sessions: Record<string, AgentSessionInfo | undefined>,
): Promise<Record<string, AgentStatus>> {
  const entries = Object.entries(sessions);
  const statuses = await Promise.all(
    entries.map(async ([, info]): Promise<AgentStatus> => {
      if (!info?.claudeSessionId || !info.directoryPath) return "no-session";
      const jsonlPath = join(
        claudeProjectDir(info.directoryPath),
        `${info.claudeSessionId}.jsonl`,
      );
      return readJsonlStatus(jsonlPath);
    }),
  );

  return Object.fromEntries(entries.map(([wsId], i) => [wsId, statuses[i]]));
}

/** List live tmux sessions for the session-picker UI. */
export async function listAvailableSessions(): Promise<
  { name: string; status: AgentStatus }[]
> {
  try {
    const { stdout } = await execFileAsync(TMUX_BIN, [
      "list-sessions",
      "-F",
      "#{session_name}",
    ]);
    return stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((name) => ({ name, status: "no-session" as AgentStatus }));
  } catch {
    return [];
  }
}

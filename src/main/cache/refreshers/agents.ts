import { watch, type FSWatcher, existsSync } from "fs";
import { stat, readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import type { Refresher } from "../refresher";
import { cacheStore } from "../store";
import { listWorkspaces, getWing, updateWorkspace } from "../../store";
import type { Workspace } from "../../../shared/types";
import { getAgentStatuses, getSessionRecap } from "../../agents";

const WORKSTREAM_STATUS_DIR = join(homedir(), ".claude", "workstream-status");
const STUCK_TOOL_THRESHOLD_MS = 8_000;
const STALE_SWEEP_INTERVAL_MS = 60_000;

interface WorkspaceCtx {
  id: string;
  tmuxSession?: string;
  claudeSessionId?: string;
  directoryPath?: string;
  jsonlPath?: string;
  /** Watcher on the JSONL file for this workspace, if applicable. */
  jsonlWatcher?: FSWatcher;
  /** Timer that flips status from "working" → "needs-input" if the agent
   *  hasn't responded to a tool call within the threshold. */
  stuckTimer?: NodeJS.Timeout;
}

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

/** Watches Claude's hook-driven status files and per-session JSONL files for
 *  the workspaces in the active wing. Pushes agent status + recap into the
 *  cache as files change — no polling. */
export class AgentsRefresher implements Refresher {
  private dirWatcher: FSWatcher | null = null;
  private contexts: Map<string, WorkspaceCtx> = new Map();
  private staleSweepTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private wingId: string) {}

  start(): void {
    if (this.stopped) return;
    void this.reconcile();

    // Watch the workstream-status dir for any add/modify. macOS FSEvents
    // surfaces individual filename events here.
    if (existsSync(WORKSTREAM_STATUS_DIR)) {
      try {
        this.dirWatcher = watch(
          WORKSTREAM_STATUS_DIR,
          (_event, filename) => void this.onStatusFileChange(filename),
        );
      } catch (err) {
        console.error("[AgentsRefresher] failed to watch status dir:", err);
      }
    }

    this.staleSweepTimer = setInterval(
      () => void this.sweepStale(),
      STALE_SWEEP_INTERVAL_MS,
    );
  }

  stop(): void {
    this.stopped = true;
    this.dirWatcher?.close();
    this.dirWatcher = null;
    if (this.staleSweepTimer) clearInterval(this.staleSweepTimer);
    this.staleSweepTimer = null;
    for (const ctx of this.contexts.values()) {
      ctx.jsonlWatcher?.close();
      if (ctx.stuckTimer) clearTimeout(ctx.stuckTimer);
      cacheStore.setAgentStatus(ctx.id, null);
      cacheStore.setRecap(ctx.id, null);
    }
    this.contexts.clear();
  }

  /** Force a reconcile + recompute. */
  async refresh(): Promise<void> {
    await this.reconcile();
  }

  /** Re-read the workspace list and adjust per-workspace contexts. Called on
   *  start and whenever workspace data changes (the wingsWatcher hook below). */
  async reconcile(): Promise<void> {
    if (this.stopped) return;
    const workspaces = listWorkspaces(this.wingId);
    const wingDir = getWing(this.wingId)?.projectDir;
    const wantIds = new Set(workspaces.map((w) => w.id));

    // Drop watchers for workspaces no longer in the wing.
    for (const [id, ctx] of this.contexts) {
      if (!wantIds.has(id)) {
        ctx.jsonlWatcher?.close();
        if (ctx.stuckTimer) clearTimeout(ctx.stuckTimer);
        this.contexts.delete(id);
        cacheStore.setAgentStatus(id, null);
        cacheStore.setRecap(id, null);
      }
    }

    for (const ws of workspaces) {
      this.upsertContext(ws, wingDir);
      // Seed cache.recap from disk so the UI has something to show before the
      // first JSONL tick lands.
      if (ws.recap) {
        cacheStore.setRecap(ws.id, {
          text: ws.recap.text,
          timestamp: ws.recap.capturedAt,
        });
      }
      await this.recompute(ws.id);
    }
  }

  private upsertContext(ws: Workspace, wingDir: string | undefined): void {
    const directoryPath = ws.worktree?.path ?? wingDir;
    const next: WorkspaceCtx = {
      id: ws.id,
      tmuxSession: ws.tmuxSession,
      claudeSessionId: ws.claudeSessionId,
      directoryPath,
      jsonlPath:
        ws.claudeSessionId && directoryPath
          ? join(claudeProjectDir(directoryPath), `${ws.claudeSessionId}.jsonl`)
          : undefined,
    };

    const existing = this.contexts.get(ws.id);
    if (existing) {
      // If the JSONL path or tmux session changed, reset its watcher.
      const jsonlChanged = existing.jsonlPath !== next.jsonlPath;
      if (jsonlChanged && existing.jsonlWatcher) {
        existing.jsonlWatcher.close();
        existing.jsonlWatcher = undefined;
      }
      Object.assign(existing, next);
      if (jsonlChanged) this.attachJsonlWatcher(existing);
      return;
    }

    this.contexts.set(ws.id, next);
    this.attachJsonlWatcher(next);
  }

  private attachJsonlWatcher(ctx: WorkspaceCtx): void {
    if (!ctx.jsonlPath || !existsSync(ctx.jsonlPath)) return;
    try {
      ctx.jsonlWatcher = watch(ctx.jsonlPath, () => {
        void this.recompute(ctx.id);
      });
    } catch {
      // Path vanished between exists check and watch — silently skip; the
      // status file watcher or next reconcile will pick it up.
    }
  }

  /** Triggered by an event in the workstream-status dir. Find the workspace
   *  whose tmuxSession matches the filename and recompute its status. */
  private async onStatusFileChange(filename: string | null): Promise<void> {
    if (!filename) return;
    for (const ctx of this.contexts.values()) {
      if (ctx.tmuxSession === filename) {
        await this.recompute(ctx.id);
        return;
      }
    }
  }

  /** Recompute agent status + recap for a workspace and push to cache. */
  private async recompute(wsId: string): Promise<void> {
    const ctx = this.contexts.get(wsId);
    if (!ctx) return;
    const sessionInfo = {
      tmuxSession: ctx.tmuxSession,
      directoryPath: ctx.directoryPath,
      claudeSessionId: ctx.claudeSessionId,
    };
    const statuses = await getAgentStatuses({ [wsId]: sessionInfo });
    const status = statuses[wsId] ?? "no-session";
    cacheStore.setAgentStatus(wsId, status);

    if (status === "working") {
      this.armStuckTimer(wsId);
    } else if (ctx.stuckTimer) {
      clearTimeout(ctx.stuckTimer);
      ctx.stuckTimer = undefined;
    }

    if (ctx.jsonlPath && existsSync(ctx.jsonlPath)) {
      const recap = await getSessionRecap(sessionInfo);
      if (recap) {
        cacheStore.setRecap(wsId, recap);
        // Persist to disk too — the MCP server and the launch-time context
        // markdown both read recap from workspace.json (out-of-process), so
        // the cache alone isn't enough.
        await this.persistRecap(wsId, recap);
      }
    }
  }

  private async persistRecap(
    wsId: string,
    recap: { text: string; timestamp: string },
  ): Promise<void> {
    try {
      const workspaces = listWorkspaces(this.wingId);
      const ws = workspaces.find((w) => w.id === wsId);
      if (!ws) return;
      if (ws.recap && ws.recap.capturedAt >= recap.timestamp) return;
      await updateWorkspace(this.wingId, {
        ...ws,
        recap: { text: recap.text, capturedAt: recap.timestamp },
      });
    } catch (err) {
      console.error("[AgentsRefresher] persistRecap failed:", err);
    }
  }

  private armStuckTimer(wsId: string): void {
    const ctx = this.contexts.get(wsId);
    if (!ctx) return;
    if (ctx.stuckTimer) clearTimeout(ctx.stuckTimer);
    ctx.stuckTimer = setTimeout(() => {
      // Re-check; if still working with an outstanding tool call, the
      // recompute path will surface "needs-input" via the stop_reason logic
      // in agents.ts.
      void this.recompute(wsId);
    }, STUCK_TOOL_THRESHOLD_MS + 100);
  }

  /** Periodic safety net: if a hook status file for a "working" session
   *  hasn't been touched in a while, recompute (the underlying logic will
   *  degrade to idle for genuinely stale sessions). */
  private async sweepStale(): Promise<void> {
    for (const ctx of this.contexts.values()) {
      if (!ctx.tmuxSession) continue;
      const file = join(WORKSTREAM_STATUS_DIR, ctx.tmuxSession);
      if (!existsSync(file)) continue;
      try {
        const info = await stat(file);
        if (Date.now() - info.mtimeMs > 30 * 60_000) {
          await this.recompute(ctx.id);
        }
      } catch {
        // file vanished mid-sweep — ignore.
      }
    }
    // Also re-read JSONL once per sweep — covers the rare case where fs.watch
    // missed a write (tmpfile rename, NFS, etc.).
    for (const ctx of this.contexts.values()) {
      if (!ctx.jsonlPath) continue;
      try {
        await readFile(ctx.jsonlPath, "utf-8");
        await this.recompute(ctx.id);
      } catch {
        // ignore
      }
    }
  }
}

import { cacheStore } from "./store";
import type { Refresher } from "./refresher";
import {
  PRBucketsRefresher,
  WatchedPRsRefresher,
  WorkspaceLinkedPRsRefresher,
} from "./refreshers/prs";
import { AgentsRefresher } from "./refreshers/agents";
import { LinksRefresher } from "./refreshers/links";
import { TmuxSessionsRefresher } from "./refreshers/tmux";

/** Coordinates the lifecycle of all refreshers. There's a global set (active
 *  always) and a wing-scoped set (rebuilt when the active wing changes). */
class Orchestrator {
  private global: Refresher[] = [];
  private wingScoped: Refresher[] = [];
  private activeWingId: string | null = null;
  private linkedPRsRefresher: WorkspaceLinkedPRsRefresher | null = null;
  private watchedPRsRefresher: WatchedPRsRefresher | null = null;
  private agentsRefresher: AgentsRefresher | null = null;
  private linksRefresher: LinksRefresher | null = null;

  registerGlobal(refresher: Refresher): void {
    this.global.push(refresher);
    refresher.start();
  }

  /** Bring up always-on refreshers (those not scoped to a wing). Called once
   *  at app startup, after the cache module is wired into IPC. */
  bootstrap(): void {
    if (this.global.length > 0) return;
    this.registerGlobal(new TmuxSessionsRefresher());
  }

  setActiveWing(wingId: string | null): void {
    if (wingId === this.activeWingId) return;
    const prev = this.activeWingId;
    this.activeWingId = wingId;

    for (const r of this.wingScoped) r.stop();
    this.wingScoped = [];
    this.linkedPRsRefresher = null;
    this.watchedPRsRefresher = null;
    this.agentsRefresher = null;
    this.linksRefresher = null;

    if (prev) {
      cacheStore.clearWingTags(prev);
      cacheStore.gcPRs();
    }

    if (wingId) {
      const buckets = new PRBucketsRefresher(wingId);
      const watched = new WatchedPRsRefresher(wingId);
      const linked = new WorkspaceLinkedPRsRefresher(wingId);
      const agents = new AgentsRefresher(wingId);
      const links = new LinksRefresher(wingId);
      this.linkedPRsRefresher = linked;
      this.watchedPRsRefresher = watched;
      this.agentsRefresher = agents;
      this.linksRefresher = links;
      this.wingScoped.push(buckets, watched, linked, agents, links);
      for (const r of this.wingScoped) r.start();
    }
  }

  /** Refresh a single linked PR — used after writes that change
   *  workspace.prs membership (drag-drop, manual add). */
  async refreshPRKey(repo: string, number: number): Promise<void> {
    await this.linkedPRsRefresher?.refreshKey(repo, number);
  }

  /** Re-tick the watched-PRs refresher. Called after watchedPRs.add/remove. */
  async refreshWatched(): Promise<void> {
    await this.watchedPRsRefresher?.refresh();
  }

  /** Re-tick the workspace-linked refresher. Called when workspace.prs
   *  changes (a key is removed, or many added at once). */
  async refreshLinked(): Promise<void> {
    await this.linkedPRsRefresher?.refresh();
  }

  /** Reconcile agent watchers when workspace data changes (added/removed
   *  workspaces, tmux session set after launch, etc.). */
  async reconcileAgents(): Promise<void> {
    await this.agentsRefresher?.reconcile();
  }

  /** Re-tick the link refresher. Called when workspace.links change so newly
   *  added URLs hydrate without waiting the full TTL. */
  async refreshLinks(): Promise<void> {
    await this.linksRefresher?.refresh();
  }

  /** Manual refresh of a single link URL. */
  async refreshLink(url: string): Promise<void> {
    await this.linksRefresher?.refreshOne(url);
  }

  /** Force a refresh on every active refresher. Used by the manual sync
   *  button. */
  async refreshAll(): Promise<void> {
    await Promise.all([
      ...this.global.map((r) => r.refresh()),
      ...this.wingScoped.map((r) => r.refresh()),
    ]);
  }

  shutdown(): void {
    for (const r of this.global) r.stop();
    for (const r of this.wingScoped) r.stop();
    this.global = [];
    this.wingScoped = [];
    this.linkedPRsRefresher = null;
    this.watchedPRsRefresher = null;
  }
}

export const orchestrator = new Orchestrator();

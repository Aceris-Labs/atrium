import { cacheStore } from "./store";
import type { Refresher } from "./refresher";
import { PRBucketsRefresher, ExplicitPRsRefresher } from "./refreshers/prs";
import { AgentsRefresher } from "./refreshers/agents";
import { LinksRefresher } from "./refreshers/links";
import { TmuxSessionsRefresher } from "./refreshers/tmux";

/** 5 days. Wings inactive longer than this have their cached PR tags reclaimed
 *  on the next sweep. PR records themselves are GC'd if no wing tags them. */
const WING_TTL_MS = 5 * 24 * 60 * 60_000;
/** Sweep every hour. The cache is small enough that the work is trivial. */
const SWEEP_INTERVAL_MS = 60 * 60_000;

/** Coordinates the lifecycle of all refreshers. There's a global set (active
 *  always) and a wing-scoped set (rebuilt when the active wing changes).
 *
 *  Wing switches retain the previous wing's cache: no more `clearWingTags` or
 *  `gcPRs` on switch, so re-entering a wing shows last-known data instantly
 *  while the new wing's refreshers tick in the background. A periodic sweep
 *  reclaims tags for wings idle longer than WING_TTL_MS. */
class Orchestrator {
  private global: Refresher[] = [];
  private wingScoped: Refresher[] = [];
  private activeWingId: string | null = null;
  private prsRefresher: PRBucketsRefresher | null = null;
  private explicitPRsRefresher: ExplicitPRsRefresher | null = null;
  private agentsRefresher: AgentsRefresher | null = null;
  private linksRefresher: LinksRefresher | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;

  registerGlobal(refresher: Refresher): void {
    this.global.push(refresher);
    refresher.start();
  }

  /** Bring up always-on refreshers (those not scoped to a wing). Called once
   *  at app startup, after the cache module is wired into IPC. */
  bootstrap(): void {
    if (this.global.length > 0) return;
    this.registerGlobal(new TmuxSessionsRefresher());
    this.startSweep();
  }

  private startSweep(): void {
    if (this.sweepTimer) return;
    // Run once immediately to clean up anything stale from a prior session
    // that's been carried in memory (no-op on fresh start).
    cacheStore.sweepStaleWings(WING_TTL_MS);
    this.sweepTimer = setInterval(
      () => cacheStore.sweepStaleWings(WING_TTL_MS),
      SWEEP_INTERVAL_MS,
    );
  }

  setActiveWing(wingId: string | null): void {
    if (wingId === this.activeWingId) return;
    this.activeWingId = wingId;

    for (const r of this.wingScoped) r.stop();
    this.wingScoped = [];
    this.prsRefresher = null;
    this.explicitPRsRefresher = null;
    this.agentsRefresher = null;
    this.linksRefresher = null;

    if (wingId) {
      cacheStore.noteWingActive(wingId);
      const buckets = new PRBucketsRefresher(wingId);
      const explicit = new ExplicitPRsRefresher(wingId);
      const agents = new AgentsRefresher(wingId);
      const links = new LinksRefresher(wingId);
      this.prsRefresher = buckets;
      this.explicitPRsRefresher = explicit;
      this.agentsRefresher = agents;
      this.linksRefresher = links;
      this.wingScoped.push(buckets, explicit, agents, links);
      for (const r of this.wingScoped) r.start();
    }
  }

  /** Refresh a single PR by ref — used after writes that change watched or
   *  workspace.prs membership (drag-drop, manual add). */
  async refreshPRKey(repo: string, number: number): Promise<void> {
    await this.explicitPRsRefresher?.refreshKey(repo, number);
  }

  /** Re-tick the explicit-PRs refresher. Called after watchedPRs.add/remove
   *  or workspace.prs mutations. */
  async refreshExplicit(): Promise<void> {
    await this.explicitPRsRefresher?.refresh();
  }

  /** Re-tick both PR refreshers. Used by the manual PR refresh button. */
  async refreshPRs(): Promise<void> {
    await Promise.all([
      this.prsRefresher?.refresh(),
      this.explicitPRsRefresher?.refresh(),
    ]);
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
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    for (const r of this.global) r.stop();
    for (const r of this.wingScoped) r.stop();
    this.global = [];
    this.wingScoped = [];
    this.prsRefresher = null;
    this.explicitPRsRefresher = null;
  }
}

export const orchestrator = new Orchestrator();

/** A Refresher owns the lifecycle of fetching one slice of remote state into
 *  the cache. Implementations vary widely (TTL polling, fs watcher, on-demand
 *  fetch). */
export interface Refresher {
  start(): void;
  stop(): void;
  /** Force an immediate refresh. Watcher-style refreshers may no-op. */
  refresh(): Promise<void>;
}

/** Simple TTL poller. Subclasses override `tick`. Single-flight per instance. */
export abstract class TTLRefresher implements Refresher {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private stopped = false;

  constructor(private intervalMs: number) {}

  start(): void {
    if (this.timer || this.stopped) return;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), this.intervalMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async refresh(): Promise<void> {
    await this.runOnce();
  }

  private async runOnce(): Promise<void> {
    if (this.inFlight || this.stopped) return;
    this.inFlight = true;
    try {
      await this.tick();
    } catch (err) {
      console.error(`[${this.constructor.name}] tick failed:`, err);
    } finally {
      this.inFlight = false;
    }
  }

  protected abstract tick(): Promise<void>;
}

import { TTLRefresher } from "../refresher";
import { cacheStore } from "../store";
import { listTmuxSessions } from "../../github";

const TMUX_TTL_MS = 30_000;

/** Polls `tmux list-sessions` and pushes the active session names into the
 *  cache. Used by workspace cards to indicate "tmux running" / "idle". */
export class TmuxSessionsRefresher extends TTLRefresher {
  constructor() {
    super(TMUX_TTL_MS);
  }

  protected async tick(): Promise<void> {
    const sessions = await listTmuxSessions();
    cacheStore.setTmuxSessions(sessions);
  }
}

import { watch, type FSWatcher } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { BrowserWindow } from "electron";
import { orchestrator } from "./cache";

const WINGS_DIR = join(homedir(), ".atrium", "wings");

/** Watches ~/.atrium/wings and emits a single coalesced event whenever the
 *  on-disk JSON changes (workspaces, watched PRs, or wing settings). The
 *  renderer listens via `data:changed` and re-fetches what it needs; the
 *  cache also reconciles its workspace-derived watchers in parallel.
 *
 *  Coalescing: rename writes (temp → real) fire two events ~ms apart. We
 *  debounce 250ms so the renderer only refreshes once per logical change. */
export function startWingsWatcher(getWindow: () => BrowserWindow | null): {
  stop: () => void;
} {
  const watchers: FSWatcher[] = [];
  let timer: NodeJS.Timeout | null = null;

  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const win = getWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send("data:changed");
      }
      void orchestrator.reconcileAgents();
      void orchestrator.refreshLinked();
      void orchestrator.refreshLinks();
      timer = null;
    }, 250);
  };

  // Recursive watch on the wings dir picks up everything in any wing folder.
  // recursive:true is supported on macOS and Windows (we ship Mac for now).
  try {
    watchers.push(watch(WINGS_DIR, { recursive: true }, fire));
  } catch {
    // Wings dir doesn't exist yet — no spaces to watch. The renderer will
    // start polling normally once the user creates the first wing.
  }

  return {
    stop: () => {
      if (timer) clearTimeout(timer);
      for (const w of watchers) w.close();
    },
  };
}

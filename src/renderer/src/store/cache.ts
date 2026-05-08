import { create } from "zustand";
import type { CacheEvent, CacheState } from "../../../shared/cacheTypes";
import { EMPTY_CACHE_STATE } from "../../../shared/cacheTypes";

interface CacheStoreApi extends CacheState {
  /** Apply a cache event from main. Internal — only the bootstrap subscriber
   *  should call this. */
  _apply: (event: CacheEvent) => void;
  /** Replace the entire state with a snapshot. Internal. */
  _replace: (state: CacheState) => void;
}

export const useCacheStore = create<CacheStoreApi>((set) => ({
  ...structuredClone(EMPTY_CACHE_STATE),
  _replace: (state) => set(state),
  _apply: (event) =>
    set((s) => {
      switch (event.type) {
        case "snapshot":
          return event.state;
        case "pr":
          if (event.pr === null) {
            const { [event.key]: _, ...rest } = s.prs;
            return { prs: rest };
          }
          return { prs: { ...s.prs, [event.key]: event.pr } };
        case "prTags": {
          const wing = s.prTags[event.wingId] ?? {};
          if (event.tags === null) {
            const { [event.key]: _, ...rest } = wing;
            return { prTags: { ...s.prTags, [event.wingId]: rest } };
          }
          return {
            prTags: {
              ...s.prTags,
              [event.wingId]: { ...wing, [event.key]: event.tags },
            },
          };
        }
        case "link":
          return { links: { ...s.links, [event.url]: event.status } };
        case "agentStatus":
          if (event.status === null) {
            const { [event.wsId]: _, ...rest } = s.agentStatus;
            return { agentStatus: rest };
          }
          return {
            agentStatus: { ...s.agentStatus, [event.wsId]: event.status },
          };
        case "recap":
          if (event.recap === null) {
            const { [event.wsId]: _, ...rest } = s.recap;
            return { recap: rest };
          }
          return { recap: { ...s.recap, [event.wsId]: event.recap } };
        case "tmuxSessions":
          return { tmuxSessions: event.sessions };
      }
    }),
}));

/** Bootstrap: pull the full snapshot from main and subscribe to push events.
 *  Call once at app startup, before first render that depends on the cache. */
export async function initCacheBridge(): Promise<void> {
  const snapshot = await window.api.cache.snapshot();
  useCacheStore.getState()._replace(snapshot);
  window.api.cache.onEvent((event) => {
    useCacheStore.getState()._apply(event);
  });
}

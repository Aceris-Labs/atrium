import { findClaudePath } from "./strategy";
import { err, nowIso } from "./types";
import type { Connector } from "./types";

export type ClaudeConfig = Record<string, never>;

export const claudeConnector: Connector<ClaudeConfig> = {
  source: "claude",
  secretFields: [],

  match(_url) {
    return false;
  },

  async hydrate(_url, _config) {
    return { ...err("unsupported"), fetchedAt: nowIso() };
  },

  async test(_config) {
    const claudePath = findClaudePath();
    if (!claudePath) {
      return {
        ok: false,
        error:
          "Claude Code not found — install with: npm install -g @anthropic-ai/claude-code",
      };
    }
    return { ok: true, identity: claudePath };
  },

  checkConfigured() {
    return findClaudePath() !== undefined;
  },
};

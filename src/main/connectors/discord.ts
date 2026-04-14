import type { DiscordConfig } from "../../shared/types";
import type { Connector } from "./types";
import { err, nowIso } from "./types";

// discord.com/channels/{guild_id}/{channel_id}/{message_id}
const DISCORD_URL_RE = /discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/i;

const API = "https://discord.com/api/v10";
const TIMEOUT_MS = 5000;

async function discordGet<T>(
  token: string,
  path: string,
): Promise<{ ok: true; data: T } | { ok: false; status?: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bot ${token}` },
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403)
      return { ok: false, status: res.status };
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

interface DiscordMessage {
  id: string;
  content?: string;
  author?: { username?: string; global_name?: string };
  timestamp?: string;
  reactions?: Array<{ count: number; emoji: { name?: string } }>;
  thread?: { message_count?: number };
}

interface DiscordChannel {
  name?: string;
  guild_id?: string;
}

interface DiscordGuild {
  name?: string;
}

function trimContent(text: string, limit = 240): string {
  const trimmed = text.trim();
  return trimmed.length > limit ? trimmed.slice(0, limit - 1) + "…" : trimmed;
}

export const discordConnector: Connector<DiscordConfig> = {
  source: "discord",
  secretFields: ["botToken"],

  match: (url) => DISCORD_URL_RE.test(url),

  async hydrate(url, config) {
    const match = url.match(DISCORD_URL_RE);
    if (!match) return err("unsupported");
    const [, guildId, channelId, messageId] = match;

    const [msgRes, channelRes] = await Promise.all([
      discordGet<DiscordMessage>(
        config.botToken,
        `/channels/${channelId}/messages/${messageId}`,
      ),
      discordGet<DiscordChannel>(config.botToken, `/channels/${channelId}`),
    ]);

    if (!msgRes.ok) {
      if (msgRes.status === 401 || msgRes.status === 403) return err("auth");
      if (msgRes.status === 404) return err("not-found");
      return err("network");
    }

    const msg = msgRes.data;
    const channelName = channelRes.ok ? channelRes.data.name : undefined;

    let serverName: string | undefined;
    const resolvedGuildId =
      channelRes.ok && channelRes.data.guild_id
        ? channelRes.data.guild_id
        : guildId;
    const guildRes = await discordGet<DiscordGuild>(
      config.botToken,
      `/guilds/${resolvedGuildId}`,
    );
    if (guildRes.ok) serverName = guildRes.data.name;

    const author = msg.author?.global_name ?? msg.author?.username;
    const reactions = msg.reactions?.map((r) => ({
      name: r.emoji.name ?? "?",
      count: r.count,
    }));

    return {
      title: msg.content ? trimContent(msg.content) : "(empty message)",
      authorName: author,
      updatedAt: msg.timestamp,
      subtitle: channelName
        ? serverName
          ? `#${channelName} · ${serverName}`
          : `#${channelName}`
        : serverName,
      commentCount: msg.thread?.message_count,
      reactions: reactions?.length ? reactions : undefined,
      fetchedAt: nowIso(),
    };
  },

  async test(config) {
    if (!config?.botToken?.trim()) {
      return { ok: false, error: "Bot token is empty" };
    }
    const res = await discordGet<{ id: string; username: string }>(
      config.botToken,
      "/users/@me",
    );
    if (!res.ok) {
      return {
        ok: false,
        error: res.status === 401 ? "Invalid bot token" : "Network error",
      };
    }
    return { ok: true, identity: `${res.data.username} (bot)` };
  },
};

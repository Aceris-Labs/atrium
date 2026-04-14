import type { LinkStatusError, SlackConfig } from "../../shared/types";
import type { Connector } from "./types";
import { err, nowIso } from "./types";

const SLACK_URL_RE =
  /([a-z0-9-]+)\.slack\.com\/archives\/([A-Z0-9]+)\/p(\d{10})(\d+)/i;
const API = "https://slack.com/api";
const TIMEOUT_MS = 5000;

// Slack URLs embed timestamps as `p<10-digit-seconds><fractional>` with no
// separator. The API wants `<seconds>.<fractional>`.
function urlTsToApiTs(seconds: string, fractional: string): string {
  return `${seconds}.${fractional}`;
}

function mapSlackError(code: string | undefined): LinkStatusError {
  switch (code) {
    case "invalid_auth":
    case "not_authed":
    case "account_inactive":
    case "token_revoked":
    case "token_expired":
      return "auth";
    case "channel_not_found":
    case "message_not_found":
    case "thread_not_found":
      return "not-found";
    case "not_in_channel":
    case "missing_scope":
    case "access_denied":
      return "forbidden";
    case "rate_limited":
    case "ratelimited":
      return "rate-limited";
    default:
      return "network";
  }
}

async function slackCall<T>(
  token: string,
  method: string,
  params: Record<string, string>,
): Promise<{ ok: true; data: T } | { ok: false; code?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${API}/${method}?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false };
    const json = (await res.json()) as { ok: boolean; error?: string } & T;
    if (!json.ok) return { ok: false, code: json.error };
    return { ok: true, data: json };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

interface HistoryResponse {
  messages?: Array<{
    text?: string;
    user?: string;
    ts?: string;
    reply_count?: number;
    reactions?: Array<{ name: string; count: number }>;
  }>;
}

interface ConversationsInfoResponse {
  channel?: { name?: string };
}

// Channel name cache: lives for the process lifetime. Channel names rarely change.
const channelNameCache = new Map<string, string>();

interface UserInfoResponse {
  user?: { profile?: { real_name?: string; display_name?: string } };
}

interface AuthTestResponse {
  url?: string;
  team?: string;
  user?: string;
  user_id?: string;
}

function trimMessage(text: string, limit = 240): string {
  const trimmed = text.trim();
  return trimmed.length > limit ? trimmed.slice(0, limit - 1) + "…" : trimmed;
}

async function fetchChannelName(
  token: string,
  channelId: string,
): Promise<string | undefined> {
  const cached = channelNameCache.get(channelId);
  if (cached !== undefined) return cached;
  const res = await slackCall<ConversationsInfoResponse>(
    token,
    "conversations.info",
    { channel: channelId },
  );
  const name = res.ok ? res.data.channel?.name : undefined;
  if (name) channelNameCache.set(channelId, name);
  return name;
}

export const slackConnector: Connector<SlackConfig> = {
  source: "slack",
  secretFields: ["botToken"],

  match: (url) => SLACK_URL_RE.test(url),

  async hydrate(url, config) {
    const match = url.match(SLACK_URL_RE);
    if (!match) return err("unsupported");
    const channel = match[2];
    const ts = urlTsToApiTs(match[3], match[4]);

    // Thread replies carry a `thread_ts` query param. When present we have
    // to use conversations.replies with the parent ts and zero in on our
    // specific reply.
    let threadTs: string | null = null;
    try {
      const parsed = new URL(url);
      threadTs = parsed.searchParams.get("thread_ts");
    } catch {
      // fall through — plain message URL
    }

    const method = threadTs ? "conversations.replies" : "conversations.history";
    const params = threadTs
      ? { channel, ts: threadTs, latest: ts, inclusive: "true", limit: "1" }
      : { channel, latest: ts, inclusive: "true", limit: "1" };

    const history = await slackCall<HistoryResponse>(
      config.botToken,
      method,
      params,
    );
    if (!history.ok) return err(mapSlackError(history.code));
    const msg = history.data.messages?.[0];
    if (!msg) return err("not-found");

    const [userRes, channelName] = await Promise.all([
      msg.user
        ? slackCall<UserInfoResponse>(config.botToken, "users.info", {
            user: msg.user,
          })
        : Promise.resolve(null),
      fetchChannelName(config.botToken, channel),
    ]);

    let author: string | undefined;
    if (userRes && userRes.ok) {
      author =
        userRes.data.user?.profile?.display_name ||
        userRes.data.user?.profile?.real_name;
    }

    const body = msg.text ?? "";
    const updatedAt = msg.ts
      ? new Date(parseFloat(msg.ts) * 1000).toISOString()
      : undefined;
    const reactions = msg.reactions?.length ? msg.reactions : undefined;

    return {
      title: trimMessage(body) || "(empty message)",
      authorName: author,
      updatedAt,
      subtitle: channelName ? `#${channelName}` : undefined,
      commentCount: msg.reply_count,
      reactions,
      fetchedAt: nowIso(),
    };
  },

  async test(config) {
    if (!config?.botToken?.trim()) {
      return { ok: false, error: "Bot token is empty" };
    }
    const res = await slackCall<AuthTestResponse>(
      config.botToken,
      "auth.test",
      {},
    );
    if (!res.ok) {
      const code = res.code;
      if (code === "invalid_auth" || code === "not_authed") {
        return { ok: false, error: "Invalid bot token" };
      }
      return { ok: false, error: code ?? "Network error" };
    }
    const identity =
      res.data.user && res.data.team
        ? `${res.data.user} @ ${res.data.team}`
        : (res.data.user ?? res.data.user_id);
    return { ok: true, identity };
  },
};

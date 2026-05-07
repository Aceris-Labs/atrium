import type {
  AwaitingReplyThread,
  InboxItem,
  PRStatus,
  Workspace,
} from "../../../shared/types";

/** Build the prKey → workspaceId map used when mapping threads to inbox items. */
export function buildPRWorkspaceMap(
  workspaces: Workspace[],
): Map<string, string> {
  const m = new Map<string, string>();
  for (const w of workspaces) {
    for (const p of w.prs) {
      m.set(`${p.repo}-${p.number}`, w.id);
    }
  }
  return m;
}

/** Convert a GitHub awaiting-reply thread into a unified InboxItem. */
export function githubAwaitingThreadToInboxItem(
  thread: AwaitingReplyThread,
  workspaceId?: string,
): InboxItem {
  const anchor = thread.path
    ? `${thread.path}${thread.line ? `:${thread.line}` : ""}`
    : "Conversation";
  const groupKey = `github:${thread.pr.repo}#${thread.pr.number}`;
  return {
    source: "github",
    kind: "thread-awaiting-reply",
    id: thread.threadId,
    url: thread.url,
    title: anchor,
    containerLabel: `${thread.pr.repo} · #${thread.pr.number}`,
    preview: cleanBody(thread.lastComment.body),
    author: thread.lastComment.author,
    updatedAt: thread.lastComment.createdAt,
    workspaceId,
    groupKey,
    groupTitle: thread.pr.title,
    groupUrl: thread.pr.url,
  };
}

/** Aggregate awaiting-reply threads across a list of PRs into InboxItems,
 *  deduped by threadId, newest first, with workspace association resolved. */
export function awaitingThreadsToInbox(
  prs: PRStatus[],
  prWorkspaceMap: Map<string, string>,
): InboxItem[] {
  const seen = new Set<string>();
  const out: InboxItem[] = [];
  for (const pr of prs) {
    if (pr.isDraft) continue;
    for (const t of pr.awaitingThreads ?? []) {
      if (seen.has(t.threadId)) continue;
      seen.add(t.threadId);
      const wsId = prWorkspaceMap.get(`${t.pr.repo}-${t.pr.number}`);
      out.push(githubAwaitingThreadToInboxItem(t, wsId));
    }
  }
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
}

/** Convert raw GitHub comment markdown into a clean one-paragraph preview.
 *  Strips images, badges, HTML tags, code fences, link syntax — the noise
 *  that bot comments are full of (shields.io badges, <sub> wrappers, etc.). */
function cleanBody(raw: string): string {
  if (!raw) return "";
  let s = raw;
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  s = s.replace(/!\[[^\]]*\]\[[^\]]*\]/g, "");
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  s = s.replace(/<[^>]+>/g, "");
  s = s.replace(/```[\s\S]*?```/g, " [code] ");
  s = s.replace(/`([^`]+)`/g, "$1");
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/\*([^*]+)\*/g, "$1");
  s = s.replace(/__([^_]+)__/g, "$1");
  s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
  s = s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

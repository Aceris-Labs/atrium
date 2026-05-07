import type { InboxItem, InboxKind } from "../../../shared/types";

interface Props {
  items: InboxItem[];
  loading?: boolean;
  onDismiss?: (item: InboxItem) => void;
}

const KIND_LABEL: Record<InboxKind, string> = {
  "thread-awaiting-reply": "awaiting reply",
  mention: "@mention",
  "review-request": "review requested",
  assignment: "assigned",
  dm: "DM",
  "thread-unread": "unread",
};

interface Group {
  /** Stable group key, used as the React key. */
  key: string;
  /** Header title for the group, or undefined for the "ungrouped" bucket. */
  title?: string;
  /** Header URL, if any. */
  url?: string;
  /** Source label rendered alongside the title. */
  sourceLabel?: string;
  items: InboxItem[];
  /** Latest updatedAt across the group, for sorting. */
  latestAt: string;
}

export function Inbox({ items, loading, onDismiss }: Props) {
  const groups = groupItems(items);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-base font-bold uppercase tracking-[0.08em] text-fg-muted">
          Awaiting your reply
        </span>
        {!loading && <span className="section-count">{items.length}</span>}
      </div>

      {loading && items.length === 0 ? (
        <div className="thread-inbox">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="thread-row">
              <span className="shimmer-bar w-full h-12 block" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="border border-dashed border-line rounded-md py-6 px-4 text-sm text-fg-muted text-center">
          No items waiting on you.
        </div>
      ) : (
        <div className="thread-inbox">
          {groups.map((g) => (
            <InboxGroup key={g.key} group={g} onDismiss={onDismiss} />
          ))}
        </div>
      )}
    </div>
  );
}

function InboxGroup({
  group,
  onDismiss,
}: {
  group: Group;
  onDismiss?: (item: InboxItem) => void;
}) {
  // Ungrouped bucket: render rows directly without a header.
  if (!group.title) {
    return (
      <div className="thread-group-rows">
        {group.items.map((it) => (
          <InboxRow key={inboxKey(it)} item={it} onDismiss={onDismiss} />
        ))}
      </div>
    );
  }
  return (
    <div className="thread-group">
      <button
        className="thread-group-header"
        onClick={() => group.url && window.api.shell.openExternal(group.url)}
        title={group.url ? `Open ${group.title}` : undefined}
      >
        <span className="thread-group-pr-title">{group.title}</span>
        {group.sourceLabel && (
          <span className="thread-group-pr-meta">{group.sourceLabel}</span>
        )}
        <span className="thread-group-count">
          {group.items.length}{" "}
          {group.items.length === 1 ? "item" : "items"}
        </span>
      </button>
      <div className="thread-group-rows">
        {group.items.map((it) => (
          <InboxRow key={inboxKey(it)} item={it} onDismiss={onDismiss} />
        ))}
      </div>
    </div>
  );
}

function InboxRow({
  item,
  onDismiss,
}: {
  item: InboxItem;
  onDismiss?: (item: InboxItem) => void;
}) {
  return (
    <div className="thread-row group relative">
      <button
        className="block w-full text-left bg-transparent border-none p-0 cursor-pointer"
        onClick={() => window.api.shell.openExternal(item.url)}
      >
        <div className="thread-row-meta">
          <span className="thread-row-author">@{item.author}</span>
          <span className="text-xs uppercase tracking-[0.04em] text-fg-muted">
            {KIND_LABEL[item.kind]}
          </span>
          {item.title && !item.groupTitle && (
            <span className="thread-row-path">{item.title}</span>
          )}
          {item.groupTitle && item.title !== item.groupTitle && (
            <span className="thread-row-path">{item.title}</span>
          )}
          {item.unreadCount && item.unreadCount > 1 && (
            <span className="text-xs text-fg-muted">
              +{item.unreadCount - 1}
            </span>
          )}
          <span className="thread-row-time">{timeAgo(item.updatedAt)}</span>
        </div>
        <div className="thread-row-body">{item.preview}</div>
      </button>
      {onDismiss && (
        <button
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-fg-muted hover:text-fg bg-transparent border-none cursor-pointer text-sm leading-none px-1"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(item);
          }}
          title="Dismiss"
        >
          ×
        </button>
      )}
    </div>
  );
}

export function inboxKey(item: InboxItem): string {
  return `${item.source}:${item.id}`;
}

function groupItems(items: InboxItem[]): Group[] {
  const groups = new Map<string, Group>();
  // Stable bucket for items without a groupKey — keeps insertion order for
  // ungrouped rows but still lets the sorter prioritize by recency.
  const UNGROUPED = "__ungrouped__";

  for (const it of items) {
    const key = it.groupKey ?? `${UNGROUPED}:${inboxKey(it)}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        title: it.groupKey ? it.groupTitle : undefined,
        url: it.groupKey ? it.groupUrl : undefined,
        sourceLabel: it.containerLabel,
        items: [],
        latestAt: it.updatedAt,
      };
      groups.set(key, g);
    }
    g.items.push(it);
    if (it.updatedAt.localeCompare(g.latestAt) > 0) g.latestAt = it.updatedAt;
  }

  for (const g of groups.values()) {
    g.items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  return [...groups.values()].sort((a, b) =>
    b.latestAt.localeCompare(a.latestAt),
  );
}

function timeAgo(iso: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const s = Math.max(1, Math.floor((now - then) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

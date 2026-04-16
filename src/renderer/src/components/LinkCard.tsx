import type {
  WorkspaceLink,
  LinkStatus,
  LinkStatusKind,
} from "../../../shared/types";

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** Derive display kind from raw status string when statusKind isn't set (agent path). */
function resolveKind(hydration: LinkStatus | undefined): LinkStatusKind {
  if (!hydration) return "unknown";
  if (hydration.statusKind) return hydration.statusKind;
  const s = (hydration.status ?? "").toLowerCase();
  if (/done|complet|resolv|clos|cancel|merged/.test(s)) return "done";
  if (/progress|review|active|working/.test(s)) return "in-progress";
  if (/block/.test(s)) return "blocked";
  if (/todo|open|triage|backlog|unstarted/.test(s)) return "open";
  return "unknown";
}

const STATUS_KIND_CLASSES: Record<LinkStatusKind, string> = {
  open: "bg-bg-input text-fg-muted border-line",
  "in-progress": "bg-bg-input text-blue border-blue",
  done: "bg-bg-input text-green border-green",
  blocked: "bg-bg-input text-red border-red",
  unknown: "bg-bg-input text-fg-muted border-line",
};

const ERROR_TOOLTIPS: Partial<
  Record<NonNullable<LinkStatus["error"]>, string>
> = {
  auth: "Authentication failed — check your API key in Settings",
  "not-configured": "Connector not configured — add one in Settings",
  "not-found": "Not found",
  forbidden: "Forbidden",
  "rate-limited": "Rate limited",
  network: "Network error",
};

interface LinkCardProps {
  link: WorkspaceLink;
  hydration?: LinkStatus;
  onDelete: () => void;
  isLoading?: boolean;
}

function SourceBadge({ source }: { source: string }) {
  return (
    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-sm bg-bg-input text-fg-muted border border-line shrink-0">
      {source}
    </span>
  );
}

function DeleteButton({ onDelete }: { onDelete: () => void }) {
  return (
    <button
      className="ml-auto shrink-0 bg-transparent border-none text-fg-muted cursor-pointer opacity-0 group-hover:opacity-100 hover:text-red transition-opacity leading-none px-[2px] text-[15px]"
      onClick={(e) => {
        e.stopPropagation();
        onDelete();
      }}
    >
      ×
    </button>
  );
}

// ── Standard card (Linear, Notion, Jira, Confluence, Coda) ──────────────────

function StandardCard({
  link,
  hydration,
  onDelete,
  isError,
  isAuthError,
  title,
}: {
  link: WorkspaceLink;
  hydration?: LinkStatus;
  onDelete: () => void;
  isError: boolean;
  isAuthError: boolean;
  title: string;
}) {
  const statusKind = resolveKind(hydration);
  const showStatus = !isError && !!hydration?.status;

  // Footer left: priority + labels + team/component chips
  const chips: string[] = [];
  if (hydration?.priority) chips.push(hydration.priority);
  hydration?.labels?.slice(0, 2).forEach((l) => chips.push(l));
  if (hydration?.subtitle) chips.push(hydration.subtitle);

  // Footer right: assignee or last editor + date
  const person = hydration?.assignee ?? hydration?.authorName;
  const date = hydration?.updatedAt;

  return (
    <>
      {/* Row 1: source + identifier — status badge + delete */}
      <div className="flex items-center gap-2 min-w-0">
        <SourceBadge source={link.source} />
        {hydration?.identifier && (
          <span className="text-xs font-mono text-fg-muted shrink-0">
            {hydration.identifier}
          </span>
        )}
        {hydration?.icon && (
          <span className="shrink-0 text-sm leading-none">
            {hydration.icon}
          </span>
        )}
        <div className="flex-1" />
        {showStatus && (
          <span
            className={`text-xs px-[6px] py-[1px] rounded-sm border shrink-0 ${STATUS_KIND_CLASSES[statusKind]}`}
          >
            {hydration!.status}
          </span>
        )}
        <DeleteButton onDelete={onDelete} />
      </div>

      {/* Row 2: title */}
      <div
        className={`text-sm font-medium leading-snug overflow-hidden line-clamp-2 ${
          isError ? "text-fg-muted italic" : "text-fg"
        }`}
      >
        {isAuthError && "🔒 "}
        {title}
      </div>

      {/* Row 3: footer (chips left, person+date right) — always rendered */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-line mt-auto">
        <div className="flex items-center gap-1 min-w-0 flex-1 overflow-hidden">
          {chips.map((c) => (
            <span
              key={c}
              className="text-xs px-1.5 py-0.5 rounded-sm bg-bg-input text-fg-muted border border-line shrink-0"
            >
              {c}
            </span>
          ))}
        </div>
        {(person || date) && (
          <div className="flex items-center gap-1.5 text-xs text-fg-muted shrink-0">
            {person && (
              <>
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-bg-input text-[10px] shrink-0">
                  {person[0].toUpperCase()}
                </span>
                <span>{person}</span>
              </>
            )}
            {person && date && <span>·</span>}
            {date && <span>{formatRelative(date)}</span>}
          </div>
        )}
      </div>
    </>
  );
}

// ── Figma card ───────────────────────────────────────────────────────────────

function FigmaCard({
  link,
  hydration,
  onDelete,
  isError,
  isAuthError,
  title,
}: {
  link: WorkspaceLink;
  hydration?: LinkStatus;
  onDelete: () => void;
  isError: boolean;
  isAuthError: boolean;
  title: string;
}) {
  return (
    <>
      {/* Row 1 */}
      <div className="flex items-center gap-2 min-w-0">
        <SourceBadge source={link.source} />
        <div className="flex-1" />
        <DeleteButton onDelete={onDelete} />
      </div>

      {/* Row 2: thumbnail + title */}
      <div className="flex flex-row gap-3 min-w-0">
        {hydration?.thumbnailUrl && (
          <img
            src={hydration.thumbnailUrl}
            alt=""
            className="w-12 h-9 rounded-sm object-cover shrink-0 self-start mt-0.5"
          />
        )}
        <div
          className={`text-sm font-medium leading-snug line-clamp-2 min-w-0 ${
            isError ? "text-fg-muted italic" : "text-fg"
          }`}
        >
          {isAuthError && "🔒 "}
          {title}
        </div>
      </div>

      {/* Row 3: footer */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-line mt-auto">
        {hydration?.subtitle && (
          <span className="text-xs px-1.5 py-0.5 rounded-sm bg-bg-input text-fg-muted border border-line">
            {hydration.subtitle}
          </span>
        )}
        <div className="flex-1" />
        {hydration?.authorName && (
          <span className="text-xs text-fg-muted shrink-0">
            {hydration.authorName}
          </span>
        )}
      </div>
    </>
  );
}

// ── Slack card ───────────────────────────────────────────────────────────────

function SlackCard({
  link,
  hydration,
  onDelete,
  isError,
  isAuthError,
  title,
}: {
  link: WorkspaceLink;
  hydration?: LinkStatus;
  onDelete: () => void;
  isError: boolean;
  isAuthError: boolean;
  title: string;
}) {
  return (
    <>
      {/* Row 1: source + channel chip + delete */}
      <div className="flex items-center gap-2 min-w-0">
        <SourceBadge source={link.source} />
        {hydration?.subtitle && (
          <span className="text-xs px-1.5 py-0.5 rounded-sm bg-bg-input text-fg-muted border border-line shrink-0">
            {hydration.subtitle}
          </span>
        )}
        <div className="flex-1" />
        <DeleteButton onDelete={onDelete} />
      </div>

      {/* Row 2: message body */}
      <p
        className={`text-sm leading-snug line-clamp-2 ${
          isError ? "text-fg-muted italic" : "text-fg"
        }`}
      >
        {isAuthError && "🔒 "}
        {title}
      </p>

      {/* Row 3: footer */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-line mt-auto">
        <div className="flex items-center gap-1.5 text-xs text-fg-muted min-w-0 flex-1 overflow-hidden">
          {hydration?.authorName && (
            <>
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-bg-input text-[10px] shrink-0">
                {hydration.authorName[0].toUpperCase()}
              </span>
              <span className="truncate">{hydration.authorName}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-fg-muted shrink-0">
          {hydration?.updatedAt && (
            <span>{formatRelative(hydration.updatedAt)}</span>
          )}
          {hydration?.commentCount != null && hydration.commentCount > 0 && (
            <span>💬 {hydration.commentCount}</span>
          )}
          {hydration?.reactions?.slice(0, 2).map((r) => (
            <span
              key={r.name}
              className="px-1 py-0.5 rounded-sm bg-bg-input border border-line"
            >
              :{r.name}: {r.count}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Skeleton variants ────────────────────────────────────────────────────────

function StandardSkeleton({ link }: { link: WorkspaceLink }) {
  return (
    <>
      <div className="flex items-center gap-2 min-w-0">
        <SourceBadge source={link.source} />
        <span className="shimmer-bar w-16" />
        <div className="flex-1" />
        <span className="shimmer-bar w-14 rounded-sm" />
      </div>
      <span className="shimmer-bar w-full block" />
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-line mt-auto">
        <div className="flex items-center gap-1.5">
          <span className="shimmer-bar w-12" />
          <span className="shimmer-bar w-16" />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="shimmer-bar w-4 h-4 rounded-full" />
          <span className="shimmer-bar w-20" />
        </div>
      </div>
    </>
  );
}

function FigmaSkeleton({ link }: { link: WorkspaceLink }) {
  return (
    <>
      <div className="flex items-center gap-2 min-w-0">
        <SourceBadge source={link.source} />
        <div className="flex-1" />
      </div>
      <div className="flex flex-row gap-3">
        <span className="shimmer-bar w-12 h-9 rounded-sm shrink-0" />
        <span className="shimmer-bar flex-1" />
      </div>
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-line mt-auto">
        <span className="shimmer-bar w-16" />
        <span className="shimmer-bar w-20" />
      </div>
    </>
  );
}

function SlackSkeleton({ link }: { link: WorkspaceLink }) {
  return (
    <>
      <div className="flex items-center gap-2">
        <SourceBadge source={link.source} />
        <span className="shimmer-bar w-20" />
      </div>
      <div>
        <span className="shimmer-bar w-full block mb-1" />
        <span className="shimmer-bar w-3/4 block" />
      </div>
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-line mt-auto">
        <div className="flex items-center gap-1.5">
          <span className="shimmer-bar w-4 h-4 rounded-full" />
          <span className="shimmer-bar w-24" />
        </div>
        <span className="shimmer-bar w-10" />
      </div>
    </>
  );
}

// ── Main export ──────────────────────────────────────────────────────────────

export function LinkCard({
  link,
  hydration,
  onDelete,
  isLoading,
}: LinkCardProps) {
  const title = hydration?.title ?? link.label;
  const isError = !!hydration?.error;
  const isAuthError =
    hydration?.error === "auth" || hydration?.error === "not-configured";
  const errorTooltip = hydration?.error
    ? ERROR_TOOLTIPS[hydration.error]
    : undefined;

  const isFigma = link.source === "figma";
  const isSlack = link.source === "slack";

  const innerProps = { link, hydration, onDelete, isError, isAuthError, title };

  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-line bg-bg-card hover:bg-bg-card-hover hover:border-line-hover cursor-pointer transition-colors group relative"
      style={{ padding: "14px 16px" }}
      onClick={() => window.api.shell.openExternal(link.url)}
      title={errorTooltip}
    >
      {isLoading ? (
        isFigma ? (
          <FigmaSkeleton link={link} />
        ) : isSlack ? (
          <SlackSkeleton link={link} />
        ) : (
          <StandardSkeleton link={link} />
        )
      ) : isFigma ? (
        <FigmaCard {...innerProps} />
      ) : isSlack ? (
        <SlackCard {...innerProps} />
      ) : (
        <StandardCard {...innerProps} />
      )}
    </div>
  );
}

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

function AuthorFooter({
  authorName,
  updatedAt,
}: {
  authorName?: string;
  updatedAt?: string;
}) {
  if (!authorName && !updatedAt) return null;
  return (
    <div className="flex items-center gap-1.5 text-xs text-fg-muted min-w-0">
      {authorName && (
        <>
          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-bg-input text-[10px] shrink-0">
            {authorName[0].toUpperCase()}
          </span>
          <span className="truncate">{authorName}</span>
        </>
      )}
      {authorName && updatedAt && <span className="shrink-0">·</span>}
      {updatedAt && (
        <span className="shrink-0">{formatRelative(updatedAt)}</span>
      )}
    </div>
  );
}

/** Standard card: Linear, Jira, Notion, Confluence, Coda */
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
  const chips: { key: string; label: string; icon?: string }[] = [];
  if (hydration?.priorityIcon) {
    chips.push({
      key: "priority-icon",
      label: hydration.priority ?? "priority",
      icon: hydration.priorityIcon,
    });
  } else if (hydration?.priority) {
    chips.push({ key: "priority", label: hydration.priority });
  }
  hydration?.labels
    ?.slice(0, 3)
    .forEach((l) => chips.push({ key: `label-${l}`, label: l }));
  if (hydration?.subtitle) {
    chips.push({ key: "subtitle", label: hydration.subtitle });
  }

  return (
    <>
      {/* Header */}
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
        <span
          className={`flex-1 text-sm font-medium truncate min-w-0 ${
            isError ? "text-fg-muted italic" : "text-fg"
          }`}
        >
          {isAuthError && "🔒 "}
          {title}
        </span>
        {hydration?.statusKind && hydration?.status && (
          <span
            className={`text-xs px-[6px] py-[1px] rounded-sm border shrink-0 ${
              STATUS_KIND_CLASSES[hydration.statusKind]
            }`}
          >
            {hydration.status}
          </span>
        )}
        <DeleteButton onDelete={onDelete} />
      </div>

      {/* Chip row */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {chips.map(({ key, label, icon }) =>
            icon ? (
              <img key={key} src={icon} alt={label} className="w-3.5 h-3.5" />
            ) : (
              <span
                key={key}
                className="px-1.5 py-0.5 rounded-sm bg-bg-input text-fg-muted border border-line"
              >
                {label}
              </span>
            ),
          )}
        </div>
      )}

      {/* Footer */}
      <AuthorFooter
        authorName={hydration?.authorName}
        updatedAt={hydration?.updatedAt}
      />
    </>
  );
}

/** Figma card: thumbnail on the left, metadata on the right */
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
    <div className="flex flex-row gap-3">
      {hydration?.thumbnailUrl && (
        <img
          src={hydration.thumbnailUrl}
          alt=""
          className="w-12 h-9 rounded-sm object-cover shrink-0 self-start mt-0.5"
        />
      )}
      <div className="flex flex-col gap-1.5 flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <SourceBadge source={link.source} />
          <span
            className={`flex-1 text-sm font-medium truncate min-w-0 ${
              isError ? "text-fg-muted italic" : "text-fg"
            }`}
          >
            {isAuthError && "🔒 "}
            {title}
          </span>
          <DeleteButton onDelete={onDelete} />
        </div>
        {hydration?.subtitle && (
          <span className="text-xs px-1.5 py-0.5 rounded-sm bg-bg-input text-fg-muted border border-line self-start">
            {hydration.subtitle}
          </span>
        )}
        <AuthorFooter
          authorName={hydration?.authorName}
          updatedAt={hydration?.updatedAt}
        />
      </div>
    </div>
  );
}

/** Slack card: message preview as primary content */
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
  const hasFooter = !!(
    hydration?.authorName ||
    hydration?.updatedAt ||
    (hydration?.commentCount != null && hydration.commentCount > 0) ||
    hydration?.reactions?.length
  );

  return (
    <>
      {/* Top row: source badge + channel chip + delete */}
      <div className="flex items-center gap-2">
        <SourceBadge source={link.source} />
        {hydration?.subtitle && (
          <span className="text-xs px-1.5 py-0.5 rounded-sm bg-bg-input text-fg-muted border border-line">
            {hydration.subtitle}
          </span>
        )}
        <DeleteButton onDelete={onDelete} />
      </div>

      {/* Message body */}
      <p
        className={`text-sm line-clamp-2 ${
          isError ? "text-fg-muted italic" : "text-fg"
        }`}
      >
        {isAuthError && "🔒 "}
        {title}
      </p>

      {/* Footer */}
      {hasFooter && (
        <div className="flex items-center gap-1.5 text-xs text-fg-muted flex-wrap">
          {hydration?.authorName && (
            <>
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-bg-input text-[10px] shrink-0">
                {hydration.authorName[0].toUpperCase()}
              </span>
              <span>{hydration.authorName}</span>
            </>
          )}
          {hydration?.updatedAt && (
            <>
              {hydration.authorName && <span>·</span>}
              <span>{formatRelative(hydration.updatedAt)}</span>
            </>
          )}
          {hydration?.commentCount != null && hydration.commentCount > 0 && (
            <span className="ml-auto">💬 {hydration.commentCount}</span>
          )}
          {hydration?.reactions?.slice(0, 3).map((r) => (
            <span
              key={r.name}
              className="px-1 py-0.5 rounded-sm bg-bg-input border border-line"
            >
              :{r.name}: {r.count}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

export function LinkCard({ link, hydration, onDelete }: LinkCardProps) {
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
      className="flex flex-col gap-2 p-3 rounded-md border border-line bg-bg-card hover:bg-bg-card-hover hover:border-line-hover cursor-pointer transition-colors group relative"
      onClick={() => window.api.shell.openExternal(link.url)}
      title={errorTooltip}
    >
      {isFigma ? (
        <FigmaCard {...innerProps} />
      ) : isSlack ? (
        <SlackCard {...innerProps} />
      ) : (
        <StandardCard {...innerProps} />
      )}
    </div>
  );
}

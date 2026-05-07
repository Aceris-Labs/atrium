import type { PRStatus } from "../../../shared/types";
import { CopyButton } from "./CopyButton";

interface Props {
  pr: PRStatus;
  tag?: "review" | "watching" | "mine";
  /** Title of the space this PR is associated with, if any. */
  spaceTitle?: string;
  dragging?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onClick?: () => void;
}

const TAG_LABEL: Record<string, string> = {
  review: "needs review",
  watching: "watching",
  mine: "mine",
};

const CI_LABEL: Record<PRStatus["ciStatus"], string> = {
  success: "CI ✓",
  failure: "CI ✗",
  pending: "CI ⟳",
  unknown: "CI ?",
};

const REVIEW_LABEL: Record<string, string> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes",
  REVIEW_REQUIRED: "review needed",
};

const REVIEW_CLASS: Record<string, string> = {
  APPROVED: "review-approved",
  CHANGES_REQUESTED: "review-changes-requested",
  REVIEW_REQUIRED: "review-required",
};

const MERGE_BADGE: Record<string, { label: string; cls: string } | null> = {
  QUEUED: { label: "queued to merge", cls: "merge-queued" },
  CLEAN: null, // ready to merge, but not special enough to badge
  BLOCKED: { label: "blocked", cls: "merge-blocked" },
  BEHIND: { label: "behind base", cls: "merge-behind" },
  UNSTABLE: { label: "unstable", cls: "merge-unstable" },
  UNKNOWN: null,
};

const CARD_BASE =
  "group h-full flex flex-col gap-2 rounded-md border border-line bg-bg-card px-4 py-[14px] cursor-pointer transition-colors hover:bg-bg-card-hover hover:border-line-hover";

export function PRCard({
  pr,
  tag,
  spaceTitle,
  dragging,
  onDragStart,
  onDragEnd,
  onClick,
}: Props) {
  const mergeBadge = pr.mergeState ? MERGE_BADGE[pr.mergeState] : null;
  const dimmed = pr.state === "merged" || pr.state === "closed";

  return (
    <div
      className={`${CARD_BASE}${dragging ? " opacity-40" : ""}${dimmed ? " opacity-60" : ""}`}
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-fg-muted font-mono">
          #{pr.number}
          {tag && (
            <span className={`pr-tag pr-tag-${tag}`}>{TAG_LABEL[tag]}</span>
          )}
        </span>
        <div className="flex gap-1 shrink-0 items-center">
          {spaceTitle && (
            <span
              className="badge space-badge"
              title={`In space: ${spaceTitle}`}
            >
              {spaceTitle}
            </span>
          )}
          {pr.state === "merged" && (
            <span className="badge merged">merged</span>
          )}
          {pr.state === "closed" && (
            <span className="badge closed">closed</span>
          )}
          {pr.isDraft && pr.state === "open" && (
            <span className="badge draft">draft</span>
          )}
          {pr.state === "open" &&
            (pr.ciStatus === "pending" ? (
              <span className="badge ci-pending">
                <span className="ci-running-dot" /> CI
              </span>
            ) : (
              <span className={`badge ci-${pr.ciStatus}`}>
                {CI_LABEL[pr.ciStatus]}
              </span>
            ))}
          {pr.autoMerge && pr.state === "open" && (
            <span className="badge merge-auto">auto-merge</span>
          )}
          <CopyButton value={pr.url} title="Copy PR URL" />
        </div>
      </div>

      <div className="text-base font-medium text-fg overflow-hidden line-clamp-2 leading-[1.4]">
        {pr.title}
      </div>

      <div className="flex items-center justify-between gap-2 pt-1 border-t border-line mt-auto">
        <span className="text-xs text-fg-muted whitespace-nowrap overflow-hidden text-ellipsis font-mono">
          {pr.repo ?? ""}
        </span>
        <div className="flex gap-1 shrink-0">
          {pr.state === "open" && (pr.threadsAwaitingYou ?? 0) > 0 ? (
            <span
              className="badge comments-awaiting"
              title={`${pr.threadsAwaitingYou} thread${pr.threadsAwaitingYou === 1 ? "" : "s"} awaiting your reply`}
            >
              ↩ {pr.threadsAwaitingYou}
            </span>
          ) : (
            pr.state === "open" &&
            pr.openComments > 0 && (
              <span className="badge comments-badge">💬 {pr.openComments}</span>
            )
          )}
          {pr.state === "open" && mergeBadge && (
            <span className={`badge ${mergeBadge.cls}`}>
              {mergeBadge.label}
            </span>
          )}
          {pr.state === "open" && pr.reviewDecision && (
            <span className={`badge ${REVIEW_CLASS[pr.reviewDecision]}`}>
              {REVIEW_LABEL[pr.reviewDecision]}
            </span>
          )}
          {pr.state === "open" && pr.author && !pr.reviewDecision && (
            <span className="text-xs text-fg-muted shrink-0">
              @{pr.author}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

interface SkeletonProps {
  number?: number;
  repo?: string;
}

export function PRCardSkeleton({ number, repo }: SkeletonProps) {
  return (
    <div className={CARD_BASE}>
      <div className="flex items-center justify-between gap-2">
        {number !== undefined ? (
          <span className="text-sm font-semibold text-fg-muted font-mono">
            #{number}
          </span>
        ) : (
          <span className="shimmer-bar w-12 h-4" />
        )}
        <div className="flex gap-1 shrink-0">
          <span className="shimmer-bar w-10 h-4" />
        </div>
      </div>
      <div className="text-base font-medium text-fg overflow-hidden leading-[1.4]">
        <span className="shimmer-bar w-full block" />
      </div>
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-line mt-auto">
        {repo !== undefined ? (
          <span className="text-xs text-fg-muted whitespace-nowrap overflow-hidden text-ellipsis font-mono">
            {repo}
          </span>
        ) : (
          <span className="shimmer-bar w-24 h-4" />
        )}
        <span className="shimmer-bar w-16 h-4" />
      </div>
    </div>
  );
}

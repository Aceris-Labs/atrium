import { useState, useEffect } from "react";
import type { Workspace, PRStatus, Item } from "../../../shared/types";

interface Props {
  workspace: Workspace;
  prStatuses: PRStatus[];
  tmuxRunning: boolean;
  agentStatus: "working" | "needs-input" | "idle" | "no-session";
  onClick: (e: React.MouseEvent) => void;
  selected?: boolean;
  draggingPR: PRStatus | null;
  onDrop: (pr: PRStatus) => void;
  draggingItem?: Item | null;
  onDropItem?: (note: Item) => void;
  onWorkspaceDragStart?: () => void;
  onWorkspaceDragEnd?: () => void;
}

const CI_LABEL: Record<PRStatus["ciStatus"], string> = {
  success: "CI ✓",
  failure: "CI ✗",
  pending: "CI …",
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

export function WorkspaceCard({
  workspace,
  prStatuses,
  tmuxRunning,
  agentStatus,
  onClick,
  selected = false,
  draggingPR,
  onDrop,
  draggingItem,
  onDropItem,
  onWorkspaceDragStart,
  onWorkspaceDragEnd,
}: Props) {
  const [isOver, setIsOver] = useState(false);
  const [fetchedPRs, setFetchedPRs] = useState<PRStatus[]>([]);

  const linkedKeys = new Set(workspace.prs.map((p) => `${p.repo}-${p.number}`));
  const allKnown = [...prStatuses, ...fetchedPRs];
  const knownByKey = new Map<string, PRStatus>();
  for (const pr of allKnown) {
    const key = `${pr.repo ?? ""}-${pr.number}`;
    if (linkedKeys.has(key) && !knownByKey.has(key)) knownByKey.set(key, pr);
  }
  // Render in workspace.prs order so the user can reorder which PR is "primary".
  const linkedPRs = workspace.prs
    .map((p) => knownByKey.get(`${p.repo}-${p.number}`))
    .filter((pr): pr is PRStatus => pr !== undefined);
  const loadingLinkedPRs = workspace.prs.filter(
    (p) =>
      !linkedPRs.find((lp) => lp.repo === p.repo && lp.number === p.number),
  );
  const totalPRCount = linkedPRs.length + loadingLinkedPRs.length;
  const primaryPR = linkedPRs[0];
  const primaryLoading = !primaryPR ? loadingLinkedPRs[0] : undefined;
  const overflowCount = totalPRCount > 1 ? totalPRCount - 1 : 0;

  useEffect(() => {
    // Cache any linked PRs currently in prStatuses so they survive a
    // temporary drop (e.g. transient fetchPR failure during sync).
    const fromStatuses = prStatuses.filter((pr) =>
      workspace.prs.some((p) => p.repo === pr.repo && p.number === pr.number),
    );
    if (fromStatuses.length > 0) {
      setFetchedPRs((prev) => {
        const existing = new Set(prev.map((p) => `${p.repo}-${p.number}`));
        const toAdd = fromStatuses.filter(
          (pr) => !existing.has(`${pr.repo}-${pr.number}`),
        );
        return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
      });
    }

    async function fetchMissing() {
      const missing = workspace.prs.filter(
        (p) =>
          !allKnown.find((k) => k.repo === p.repo && k.number === p.number),
      );
      if (missing.length === 0) return;
      const results = await Promise.all(
        missing.map((p) => window.api.github.fetchPR(p.repo, p.number)),
      );
      const valid = results.filter((r): r is PRStatus => r !== null);
      if (valid.length > 0) setFetchedPRs((prev) => [...prev, ...valid]);
    }
    fetchMissing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id, workspace.prs, prStatuses]);

  const alreadyLinked = draggingPR
    ? linkedKeys.has(`${draggingPR.repo ?? ""}-${draggingPR.number}`)
    : false;
  const isPRDropTarget = draggingPR !== null && !alreadyLinked;
  const isItemDropTarget = !!draggingItem && !!onDropItem;
  const isDropTarget = isPRDropTarget || isItemDropTarget;

  return (
    <div
      className={`card ${workspace.status}${isOver && isDropTarget ? " drop-target" : ""}${isDropTarget ? " drop-ready" : ""}${selected ? " card-selected" : ""}`}
      draggable={!!onWorkspaceDragStart}
      onClick={(e) => onClick(e)}
      onDragStart={(e) => {
        e.stopPropagation();
        onWorkspaceDragStart?.();
      }}
      onDragEnd={onWorkspaceDragEnd}
      onDragOver={(e) => {
        if (isDropTarget) {
          e.preventDefault();
          e.stopPropagation();
          setIsOver(true);
        }
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsOver(false);
        if (draggingPR && !alreadyLinked) {
          e.stopPropagation();
          onDrop(draggingPR);
        } else if (draggingItem && onDropItem) {
          e.stopPropagation();
          onDropItem(draggingItem);
        }
      }}
    >
      <div className="card-header">
        <div className={`card-status-dot ${workspace.status}`} />
        <div className="card-title-group">
          <div className="card-title">{workspace.title}</div>
          {workspace.branch && (
            <div className="card-branch">{workspace.branch}</div>
          )}
        </div>
        <span className={`card-type-badge ${workspace.type}`}>
          {workspace.type}
        </span>
      </div>

      <div className="pr-list pr-list-slot">
        {primaryPR ? (
          <div
            className={`pr-row${primaryPR.state === "merged" || primaryPR.state === "closed" ? " opacity-60" : ""}`}
          >
            <span className="pr-number">#{primaryPR.number}</span>
            <span className="pr-title">{primaryPR.title}</span>
            <div className="pr-badges">
              {primaryPR.state === "merged" && (
                <span className="badge merged">merged</span>
              )}
              {primaryPR.state === "closed" && (
                <span className="badge closed">closed</span>
              )}
              {primaryPR.state === "open" && primaryPR.isDraft && (
                <span className="badge draft">draft</span>
              )}
              {primaryPR.state === "open" && (
                <span className={`badge ci-${primaryPR.ciStatus}`}>
                  {CI_LABEL[primaryPR.ciStatus]}
                </span>
              )}
              {primaryPR.state === "open" && primaryPR.reviewDecision && (
                <span
                  className={`badge ${REVIEW_CLASS[primaryPR.reviewDecision]}`}
                >
                  {REVIEW_LABEL[primaryPR.reviewDecision]}
                </span>
              )}
            </div>
          </div>
        ) : primaryLoading ? (
          <div className="pr-row" style={{ opacity: 0.4 }}>
            <span className="pr-number">#{primaryLoading.number}</span>
            <span className="pr-title">Loading…</span>
          </div>
        ) : workspace.recap?.text ? (
          <div className="pr-row pr-row-recap">
            <span className="text-xs text-fg-muted line-clamp-2 leading-snug">
              {workspace.recap.text}
            </span>
          </div>
        ) : (
          <div className="pr-row pr-row-empty">
            <span className="text-fg-muted text-sm italic">
              No PRs linked
            </span>
          </div>
        )}
        {overflowCount > 0 ? (
          <div className="pr-row pr-row-overflow">
            <span className="text-xs text-fg-muted">
              +{overflowCount} more
            </span>
          </div>
        ) : (
          <div className="pr-row pr-row-overflow" />
        )}
      </div>

      <div className="card-footer">
        {isOver && isDropTarget ? (
          <span className="drop-hint">
            {draggingPR
              ? `Drop to link PR #${draggingPR.number}`
              : "Drop to attach note"}
          </span>
        ) : (
          <div className="card-status-row">
            {agentStatus !== "no-session" ? (
              <div
                className={`agent-badge ${agentStatus}`}
                title={tmuxRunning ? "tmux running" : "tmux not running"}
              >
                <div className={`agent-dot ${agentStatus}`} />
                {agentStatus === "working" && "claude working"}
                {agentStatus === "needs-input" && "needs input"}
                {agentStatus === "idle" && "claude idle"}
              </div>
            ) : (
              <div className="tmux-status">
                <div className={`tmux-dot ${tmuxRunning ? "running" : ""}`} />
                {tmuxRunning ? "tmux" : "idle"}
              </div>
            )}
          </div>
        )}
        <span className="card-chevron">›</span>
      </div>
    </div>
  );
}

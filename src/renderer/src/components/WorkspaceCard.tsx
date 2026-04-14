import { useState, useEffect } from "react";
import type { Workspace, PRStatus } from "../../../shared/types";

interface Props {
  workspace: Workspace;
  prStatuses: PRStatus[];
  tmuxRunning: boolean;
  agentStatus: "working" | "needs-input" | "idle" | "no-session";
  onClick: () => void;
  draggingPR: PRStatus | null;
  onDrop: (pr: PRStatus) => void;
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
  draggingPR,
  onDrop,
}: Props) {
  const [isOver, setIsOver] = useState(false);
  const [fetchedPRs, setFetchedPRs] = useState<PRStatus[]>([]);

  const linkedKeys = new Set(workspace.prs.map((p) => `${p.repo}-${p.number}`));
  const allKnown = [...prStatuses, ...fetchedPRs];
  const linkedPRs = allKnown
    .filter((pr) => linkedKeys.has(`${pr.repo ?? ""}-${pr.number}`))
    .filter(
      (pr, i, arr) =>
        arr.findIndex((p) => p.repo === pr.repo && p.number === pr.number) ===
        i,
    );
  const loadingLinkedPRs = workspace.prs.filter(
    (p) =>
      !linkedPRs.find((lp) => lp.repo === p.repo && lp.number === p.number),
  );

  useEffect(() => {
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
  const isDropTarget = draggingPR !== null && !alreadyLinked;

  return (
    <div
      className={`card ${workspace.status}${isOver && isDropTarget ? " drop-target" : ""}${isDropTarget ? " drop-ready" : ""}`}
      onClick={onClick}
      onDragOver={(e) => {
        if (isDropTarget) {
          e.preventDefault();
          setIsOver(true);
        }
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsOver(false);
        if (draggingPR && !alreadyLinked) onDrop(draggingPR);
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

      {(linkedPRs.length > 0 || loadingLinkedPRs.length > 0) && (
        <div className="pr-list">
          {linkedPRs.map((pr) => (
            <div
              key={`${pr.repo ?? ""}-${pr.number}`}
              className={`pr-row${pr.state === "merged" || pr.state === "closed" ? " opacity-60" : ""}`}
            >
              <span className="pr-number">#{pr.number}</span>
              <span className="pr-title">{pr.title}</span>
              <div className="pr-badges">
                {pr.state === "merged" && (
                  <span className="badge merged">merged</span>
                )}
                {pr.state === "closed" && (
                  <span className="badge closed">closed</span>
                )}
                {pr.state === "open" && pr.isDraft && (
                  <span className="badge draft">draft</span>
                )}
                {pr.state === "open" && (
                  <span className={`badge ci-${pr.ciStatus}`}>
                    {CI_LABEL[pr.ciStatus]}
                  </span>
                )}
                {pr.state === "open" && pr.reviewDecision && (
                  <span className={`badge ${REVIEW_CLASS[pr.reviewDecision]}`}>
                    {REVIEW_LABEL[pr.reviewDecision]}
                  </span>
                )}
              </div>
            </div>
          ))}
          {loadingLinkedPRs.map((p) => (
            <div
              key={`${p.repo}-${p.number}`}
              className="pr-row"
              style={{ opacity: 0.4 }}
            >
              <span className="pr-number">#{p.number}</span>
              <span className="pr-title">Loading…</span>
            </div>
          ))}
        </div>
      )}

      <div className="card-footer">
        {isOver && isDropTarget ? (
          <span className="drop-hint">
            Drop to link PR #{draggingPR!.number}
          </span>
        ) : (
          <div className="card-status-row">
            <div className="tmux-status">
              <div className={`tmux-dot ${tmuxRunning ? "running" : ""}`} />
              {tmuxRunning ? "tmux" : "idle"}
            </div>
            {agentStatus !== "no-session" && (
              <div className={`agent-badge ${agentStatus}`}>
                <div className={`agent-dot ${agentStatus}`} />
                {agentStatus === "working" && "claude working"}
                {agentStatus === "needs-input" && "needs input"}
                {agentStatus === "idle" && "claude idle"}
              </div>
            )}
          </div>
        )}
        <span className="card-chevron">›</span>
      </div>
    </div>
  );
}

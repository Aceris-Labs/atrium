import type { PRStatus } from '../../../shared/types'

interface Props {
  pr: PRStatus
  tag?: 'review' | 'watching' | 'mine'
  dragging?: boolean
  onDragStart?: () => void
  onDragEnd?: () => void
  onClick?: () => void
}

const TAG_LABEL: Record<string, string> = {
  review: 'needs review',
  watching: 'watching',
  mine: 'mine'
}

const CI_LABEL: Record<PRStatus['ciStatus'], string> = {
  success: 'CI ✓',
  failure: 'CI ✗',
  pending: 'CI ⟳',
  unknown: 'CI ?'
}

const REVIEW_LABEL: Record<string, string> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes',
  REVIEW_REQUIRED: 'review needed'
}

const REVIEW_CLASS: Record<string, string> = {
  APPROVED: 'review-approved',
  CHANGES_REQUESTED: 'review-changes-requested',
  REVIEW_REQUIRED: 'review-required'
}

const MERGE_BADGE: Record<string, { label: string; cls: string } | null> = {
  QUEUED: { label: 'queued to merge', cls: 'merge-queued' },
  CLEAN: null, // ready to merge, but not special enough to badge
  BLOCKED: { label: 'blocked', cls: 'merge-blocked' },
  BEHIND: { label: 'behind base', cls: 'merge-behind' },
  UNSTABLE: { label: 'unstable', cls: 'merge-unstable' },
  UNKNOWN: null
}

export function PRCard({ pr, tag, dragging, onDragStart, onDragEnd, onClick }: Props) {
  const mergeBadge = pr.mergeState ? MERGE_BADGE[pr.mergeState] : null

  return (
    <div
      className={`pr-card${dragging ? ' dragging' : ''}${pr.state === 'merged' ? ' merged' : ''}${pr.state === 'closed' ? ' closed' : ''}`}
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
    >
      <div className="pr-card-header">
        <span className="pr-card-number">
          #{pr.number}
          {tag && <span className={`pr-tag pr-tag-${tag}`}>{TAG_LABEL[tag]}</span>}
        </span>
        <div className="pr-card-badges">
          {pr.state === 'merged' && <span className="badge merged">merged</span>}
          {pr.state === 'closed' && <span className="badge closed">closed</span>}
          {pr.isDraft && pr.state === 'open' && <span className="badge draft">draft</span>}
          {pr.state === 'open' && (
            pr.ciStatus === 'pending' ? (
              <span className="badge ci-pending"><span className="ci-running-dot" /> CI</span>
            ) : (
              <span className={`badge ci-${pr.ciStatus}`}>{CI_LABEL[pr.ciStatus]}</span>
            )
          )}
          {pr.autoMerge && pr.state === 'open' && <span className="badge merge-auto">auto-merge</span>}
        </div>
      </div>

      <div className="pr-card-title">{pr.title}</div>

      <div className="pr-card-footer">
        <span className="pr-card-repo">{pr.repo ?? ''}</span>
        <div className="pr-card-footer-badges">
          {pr.openComments > 0 && (
            <span className="badge comments-badge">💬 {pr.openComments}</span>
          )}
          {mergeBadge && (
            <span className={`badge ${mergeBadge.cls}`}>{mergeBadge.label}</span>
          )}
          {pr.reviewDecision && (
            <span className={`badge ${REVIEW_CLASS[pr.reviewDecision]}`}>
              {REVIEW_LABEL[pr.reviewDecision]}
            </span>
          )}
          {pr.author && !pr.reviewDecision && (
            <span className="pr-card-author">@{pr.author}</span>
          )}
        </div>
      </div>
    </div>
  )
}

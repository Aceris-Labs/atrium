import { useEffect, useState } from 'react'
import { WorktreeSelector } from './WorktreeSelector'
import type { Workspace, WorktreeInfo } from '../../../shared/types'

interface Props {
  onAdd: (data: Omit<Workspace, 'id' | 'createdAt' | 'updatedAt'>) => void
  onClose: () => void
}

export function AddWorkspaceModal({ onAdd, onClose }: Props) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState<Workspace['type']>('project')
  const [worktreePath, setWorktreePath] = useState<string | undefined>(undefined)
  const [branch, setBranch] = useState('')
  const [defaultRepoPath, setDefaultRepoPath] = useState<string | undefined>(undefined)

  // Default to the main repo's worktree
  useEffect(() => {
    window.api.worktrees.list().then((wts) => {
      if (wts.length > 0 && !worktreePath) {
        setWorktreePath(wts[0].path)
        setBranch(wts[0].branch)
        setDefaultRepoPath(wts[0].path)
      }
    })
  }, [])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    onAdd({
      title: title.trim(),
      type,
      status: 'active',
      branch: branch || undefined,
      worktreePath,
      prs: [],
      todos: [],
      notes: [],
      links: []
    })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">New workspace</div>
        <form onSubmit={handleSubmit} style={{ display: 'contents' }}>
          <div className="form-group">
            <label className="form-label">Title</label>
            <input
              className="form-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. auth-refactor"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label">Type</label>
            <select
              className="form-select"
              value={type}
              onChange={(e) => setType(e.target.value as Workspace['type'])}
            >
              <option value="project">project</option>
              <option value="task">task</option>
              <option value="note">note</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Worktree</label>
            <WorktreeSelector
              value={worktreePath}
              onChange={(path, br) => {
                setWorktreePath(path)
                if (br) setBranch(br)
              }}
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Add workspace
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

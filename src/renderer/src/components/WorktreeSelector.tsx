import { useEffect, useState } from 'react'
import type { WorktreeInfo } from '../../../shared/types'

interface Props {
  value: string | undefined // current worktree path
  onChange: (path: string, branch?: string) => void
}

export function WorktreeSelector({ value, onChange }: Props) {
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([])
  const [open, setOpen] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newBranch, setNewBranch] = useState('')
  const [isNewBranch, setIsNewBranch] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    window.api.worktrees.list().then(setWorktrees)
  }, [])

  const selected = worktrees.find((wt) => wt.path === value)

  // Group worktrees by repo
  const grouped: Record<string, WorktreeInfo[]> = {}
  for (const wt of worktrees) {
    if (!grouped[wt.repoName]) grouped[wt.repoName] = []
    grouped[wt.repoName].push(wt)
  }

  // Find the main repo path (first worktree, typically the main checkout)
  const mainRepoPath = worktrees.length > 0 ? worktrees[0].path : undefined

  async function handleCreate() {
    if (!mainRepoPath || !newName.trim() || !newBranch.trim()) return
    setCreating(true)
    setError('')
    try {
      const wt = await window.api.worktrees.create(mainRepoPath, newName.trim(), newBranch.trim(), isNewBranch)
      setWorktrees((prev) => [...prev, wt])
      onChange(wt.path, wt.branch)
      setShowCreate(false)
      setOpen(false)
      setNewName('')
      setNewBranch('')
    } catch (e: any) {
      setError(e.message ?? 'Failed to create worktree')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="wt-selector">
      <button
        className="wt-trigger"
        onClick={() => setOpen(!open)}
        type="button"
      >
        {selected ? (
          <span className="wt-trigger-content">
            <code className="wt-trigger-branch">{selected.branch}</code>
            <span className="wt-trigger-path">{selected.displayPath}</span>
          </span>
        ) : value ? (
          <span className="wt-trigger-content">
            <span className="wt-trigger-path">{value.replace(/^\/Users\/[^/]+/, '~')}</span>
          </span>
        ) : (
          <span className="wt-trigger-placeholder">Select worktree…</span>
        )}
        <span className="wt-trigger-chevron">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="wt-dropdown">
          <div className="wt-list">
            {Object.entries(grouped).map(([repo, wts]) => (
              <div key={repo}>
                <div className="wt-group-label">{repo}</div>
                {wts.map((wt) => (
                  <button
                    key={wt.path}
                    className={`wt-option${wt.path === value ? ' selected' : ''}`}
                    onClick={() => {
                      onChange(wt.path, wt.branch)
                      setOpen(false)
                    }}
                  >
                    <code className="wt-option-branch">{wt.branch}</code>
                    <span className="wt-option-path">{wt.displayPath}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>

          <div className="wt-divider" />

          {!showCreate ? (
            <button
              className="wt-create-btn"
              onClick={() => setShowCreate(true)}
            >
              + Create new worktree
            </button>
          ) : (
            <div className="wt-create-form">
              <div className="form-group">
                <label className="form-label">Name</label>
                <input
                  className="form-input"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="my-feature"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="form-label">Branch</label>
                <input
                  className="form-input"
                  value={newBranch}
                  onChange={(e) => setNewBranch(e.target.value)}
                  placeholder={isNewBranch ? 'feat/my-branch' : 'existing-branch'}
                />
              </div>
              <label className="wt-checkbox-label">
                <input
                  type="checkbox"
                  checked={isNewBranch}
                  onChange={(e) => setIsNewBranch(e.target.checked)}
                />
                Create new branch
              </label>
              {error && <span className="pr-input-error">{error}</span>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost" onClick={() => { setShowCreate(false); setError('') }}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>
                  {creating ? 'Creating…' : 'Create'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

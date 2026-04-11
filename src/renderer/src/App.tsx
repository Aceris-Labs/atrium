import { useCallback, useEffect, useRef, useState } from 'react'
import { WorkspaceCard } from './components/WorkspaceCard'
import { WorkspaceDetail } from './components/WorkspaceDetail'
import { AddWorkspaceModal } from './components/AddWorkspaceModal'
import { SettingsModal } from './components/SettingsModal'
import { SetupWizard } from './components/SetupWizard'
import { PRCard } from './components/PRCard'
import type { PRStatus, Workspace } from '../../shared/types'

export default function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [myPRs, setMyPRs] = useState<PRStatus[]>([])
  const [reviewPRs, setReviewPRs] = useState<PRStatus[]>([])
  const [tmuxSessions, setTmuxSessions] = useState<string[]>([])
  const [agentStatuses, setAgentStatuses] = useState<Record<string, string>>({})
  const [setupDone, setSetupDone] = useState<boolean | null>(null) // null = loading
  const [syncing, setSyncing] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draggingPR, setDraggingPR] = useState<PRStatus | null>(null)
  const [watchedPRStatuses, setWatchedPRStatuses] = useState<PRStatus[]>([])
  const [watchInput, setWatchInput] = useState('')
  const [watchError, setWatchError] = useState('')
  const syncRef = useRef(false)

  async function loadWorkspaces() {
    const ws = await window.api.workspaces.list()
    setWorkspaces(ws)
  }

  const syncAll = useCallback(async () => {
    if (syncRef.current) return
    syncRef.current = true
    setSyncing(true)
    try {
      const [prs, reviews, sessions] = await Promise.all([
        window.api.github.myPRs(),
        window.api.github.reviewRequests(),
        window.api.github.tmuxSessions()
      ])
      setMyPRs(prs)
      setReviewPRs(reviews)
      setTmuxSessions(sessions)

      // Fetch agent statuses by tmux session name
      const ws = await window.api.workspaces.list()
      if (ws.length > 0) {
        const sessionMap: Record<string, string | undefined> = {}
        ws.forEach((w) => { sessionMap[w.id] = w.tmuxSession })
        const statuses = await window.api.agents.statuses(sessionMap)
        setAgentStatuses(statuses)
      }
    } finally {
      syncRef.current = false
      setSyncing(false)
    }
  }, [])

  const pollAgents = useCallback(async () => {
    const ws = await window.api.workspaces.list()
    if (ws.length > 0) {
      const sessionMap: Record<string, string | undefined> = {}
      ws.forEach((w) => { sessionMap[w.id] = w.tmuxSession })
      const statuses = await window.api.agents.statuses(sessionMap)
      setAgentStatuses(statuses)
    }
  }, [])

  async function loadWatched() {
    const watched = await window.api.watchedPRs.list()
    if (watched.length > 0) {
      const results = await Promise.all(
        watched.map((w) => window.api.github.fetchPR(w.repo, w.number))
      )
      setWatchedPRStatuses(results.filter((r): r is PRStatus => r !== null))
    } else {
      setWatchedPRStatuses([])
    }
  }

  async function handleAddWatched() {
    const input = watchInput.trim()
    if (!input) return

    // Try URL first
    const urlMatch = input.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/)
    if (urlMatch) {
      await window.api.watchedPRs.add({ repo: urlMatch[1], number: parseInt(urlMatch[2], 10) })
      setWatchInput('')
      setWatchError('')
      loadWatched()
      return
    }

    // Try plain number — use default repo
    const num = parseInt(input, 10)
    if (!isNaN(num) && num > 0) {
      const repo = await window.api.github.defaultRepo()
      if (!repo) {
        setWatchError('Set a root directory in settings to use PR numbers')
        return
      }
      await window.api.watchedPRs.add({ repo, number: num })
      setWatchInput('')
      setWatchError('')
      loadWatched()
      return
    }

    setWatchError('Enter a PR number or paste a GitHub URL')
  }

  async function handleRemoveWatched(num: number) {
    await window.api.watchedPRs.remove(num)
    loadWatched()
  }

  useEffect(() => {
    window.api.config.get().then((c) => setSetupDone(c.setupComplete ?? false))
  }, [])

  useEffect(() => {
    if (setupDone !== true) return
    loadWorkspaces()
    loadWatched()
    syncAll()
    const prInterval = setInterval(syncAll, 60_000)
    const agentInterval = setInterval(pollAgents, 5_000)
    return () => { clearInterval(prInterval); clearInterval(agentInterval) }
  }, [setupDone, syncAll, pollAgents])

  async function handleAdd(data: Omit<Workspace, 'id' | 'createdAt' | 'updatedAt'>) {
    const created = await window.api.workspaces.create(data)
    setWorkspaces((prev) => [...prev, created])
    setShowAdd(false)
  }

  async function handleUpdate(updated: Workspace) {
    const saved = await window.api.workspaces.update(updated)
    setWorkspaces((prev) => prev.map((w) => (w.id === saved.id ? saved : w)))
  }

  async function handleDropPR(workspace: Workspace, pr: PRStatus) {
    if (workspace.prs.includes(pr.number)) return
    await handleUpdate({
      ...workspace,
      prs: [...workspace.prs, pr.number],
      // Auto-set repo from the PR if workspace doesn't have one
      ...(!workspace.repo && pr.repo ? { repo: pr.repo } : {})
    })
  }

  async function handleDelete(id: string) {
    await window.api.workspaces.delete(id)
    setWorkspaces((prev) => prev.filter((w) => w.id !== id))
    setSelectedId(null)
  }

  const allPRs = [...myPRs, ...reviewPRs].reduce<PRStatus[]>((acc, pr) => {
    if (!acc.find((p) => p.number === pr.number)) acc.push(pr)
    return acc
  }, [])

  const selectedWorkspace = selectedId ? workspaces.find((w) => w.id === selectedId) : null

  // ── Detail view ──────────────────────────────────────────────────────────
  // ── Setup wizard ──────────────────────────────────────────────────────────
  if (setupDone === null) return null // loading config
  if (setupDone === false) {
    return (
      <SetupWizard onComplete={() => {
        setSetupDone(true)
        loadWorkspaces()
        loadWatched()
        syncAll()
      }} />
    )
  }

  // ── Detail view ──────────────────────────────────────────────────────────
  if (selectedWorkspace) {
    return (
      <div className="layout">
        <div className="titlebar">
          <button className="back-btn" onClick={() => setSelectedId(null)}>
            ← All workspaces
          </button>
          <div className="titlebar-actions">
            {syncing && <div className="spinner" />}
            <button className="btn btn-ghost" onClick={syncAll}>Sync</button>
            <button className="btn btn-ghost" onClick={() => setShowSettings(true)}>⚙</button>
          </div>
        </div>
        <WorkspaceDetail
          workspace={selectedWorkspace}
          prStatuses={allPRs}
          reviewPRNumbers={new Set(reviewPRs.map((p) => p.number))}
          watchedPRNumbers={new Set(watchedPRStatuses.map((p) => p.number))}
          myPRNumbers={new Set(myPRs.map((p) => p.number))}
          tmuxSessions={tmuxSessions}
          agentStatus={agentStatuses[selectedWorkspace.id] ?? 'no-session'}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          onBack={() => setSelectedId(null)}
        />
        {showSettings && (
          <SettingsModal
            onClose={() => setShowSettings(false)}
            onSave={syncAll}
            onRerunSetup={async () => {
              await window.api.config.set({ setupComplete: false })
              setSetupDone(false)
            }}
          />
        )}
      </div>
    )
  }

  // ── Dashboard ────────────────────────────────────────────────────────────
  const linkedPRNumbers = new Set(workspaces.flatMap((w) => w.prs))
  const unlinkedReviews = reviewPRs.filter((pr) => !linkedPRNumbers.has(pr.number))
  const unlinkedMyPRs = myPRs.filter((pr) => !linkedPRNumbers.has(pr.number))
  const activeWorkspaces = workspaces.filter((w) => w.status === 'active')
  const otherWorkspaces = workspaces.filter((w) => w.status !== 'active')

  return (
    <div className="layout">
      <div className="titlebar">
        <span className="titlebar-title">Atrium</span>
        <div className="titlebar-actions">
          {syncing && <div className="spinner" />}
          <button className="btn btn-ghost" onClick={syncAll}>Sync</button>
          <button className="btn btn-ghost" onClick={() => setShowSettings(true)}>⚙</button>
        </div>
      </div>

      <div className="content">
        {/* ── Spaces ─────────────────────────────────────────────── */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Spaces</span>
            <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>+ New</button>
          </div>
          <div className="panel-body">
            {activeWorkspaces.length > 0 && (
              <div className="section">
                <div className="section-header">
                  <span className="section-title">Active</span>
                  <span className="section-count">{activeWorkspaces.length}</span>
                </div>
                <div className="card-grid">
                  {activeWorkspaces.map((ws) => (
                    <WorkspaceCard
                      key={ws.id}
                      workspace={ws}
                      prStatuses={allPRs}
                      tmuxRunning={ws.tmuxSession ? tmuxSessions.includes(ws.tmuxSession) : false}
                      agentStatus={agentStatuses[ws.id] ?? 'no-session'}
                      onClick={() => setSelectedId(ws.id)}
                      draggingPR={draggingPR}
                      onDrop={(pr) => handleDropPR(ws, pr)}
                    />
                  ))}
                </div>
              </div>
            )}
            {otherWorkspaces.length > 0 && (
              <div className="section">
                <div className="section-header">
                  <span className="section-title">Other</span>
                  <span className="section-count">{otherWorkspaces.length}</span>
                </div>
                <div className="card-grid">
                  {otherWorkspaces.map((ws) => (
                    <WorkspaceCard
                      key={ws.id}
                      workspace={ws}
                      prStatuses={allPRs}
                      tmuxRunning={ws.tmuxSession ? tmuxSessions.includes(ws.tmuxSession) : false}
                      agentStatus={agentStatuses[ws.id] ?? 'no-session'}
                      onClick={() => setSelectedId(ws.id)}
                      draggingPR={draggingPR}
                      onDrop={(pr) => handleDropPR(ws, pr)}
                    />
                  ))}
                </div>
              </div>
            )}
            {workspaces.length === 0 && (
              <div className="empty">
                <div className="empty-title">No spaces yet</div>
                <p>Add your first space to start tracking PRs, branches, and agents.</p>
              </div>
            )}
          </div>
        </div>

        {/* ── Pull Requests ──────────────────────────────────────── */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Pull Requests</span>
          </div>
            <div className="panel-body">
              {unlinkedReviews.length > 0 && (
                <div className="section">
                  <div className="section-header">
                    <span className="section-title">Needs your review</span>
                    <span className="section-count">{unlinkedReviews.length}</span>
                  </div>
                  <div className="card-grid card-grid-sm">
                    {unlinkedReviews.map((pr) => (
                      <PRCard
                        key={pr.number}
                        pr={pr}
                        dragging={draggingPR?.number === pr.number}
                        onDragStart={() => setDraggingPR(pr)}
                        onDragEnd={() => setDraggingPR(null)}
                        onClick={() => window.api.shell.openExternal(pr.url)}
                      />
                    ))}
                  </div>
                </div>
              )}
              {unlinkedMyPRs.length > 0 && (
                <div className="section">
                  <div className="section-header">
                    <span className="section-title">My open PRs</span>
                    <span className="section-count">{unlinkedMyPRs.length}</span>
                  </div>
                  <div className="card-grid card-grid-sm">
                    {unlinkedMyPRs.map((pr) => (
                      <PRCard
                        key={pr.number}
                        pr={pr}
                        dragging={draggingPR?.number === pr.number}
                        onDragStart={() => setDraggingPR(pr)}
                        onDragEnd={() => setDraggingPR(null)}
                        onClick={() => window.api.shell.openExternal(pr.url)}
                      />
                    ))}
                  </div>
                </div>
              )}
              {/* Watching */}
              <div className="section">
                <div className="section-header">
                  <span className="section-title">Watching</span>
                  {watchedPRStatuses.length > 0 && <span className="section-count">{watchedPRStatuses.length}</span>}
                  <div className="section-header-right">
                    <input
                      className="form-input form-input-sm"
                      value={watchInput}
                      onChange={(e) => { setWatchInput(e.target.value); setWatchError('') }}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddWatched()}
                      placeholder="PR # or URL"
                    />
                    <button className="btn btn-ghost btn-sm" onClick={handleAddWatched}>Watch</button>
                    {watchError && <span className="pr-input-error">{watchError}</span>}
                  </div>
                </div>
                {watchedPRStatuses.length > 0 && (
                  <div className="card-grid card-grid-sm">
                    {watchedPRStatuses.map((pr) => (
                      <div key={pr.number} className="detail-pr-card-wrapper">
                        <PRCard
                          pr={pr}
                          dragging={draggingPR?.number === pr.number}
                          onDragStart={() => setDraggingPR(pr)}
                          onDragEnd={() => setDraggingPR(null)}
                          onClick={() => window.api.shell.openExternal(pr.url)}
                        />
                        <button
                          className="detail-pr-remove-overlay"
                          onClick={() => handleRemoveWatched(pr.number)}
                          title="Stop watching"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
      </div>

      {showAdd && <AddWorkspaceModal onAdd={handleAdd} onClose={() => setShowAdd(false)} />}
      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onSave={syncAll}
          onRerunSetup={async () => {
            await window.api.config.set({ setupComplete: false })
            setSetupDone(false)
          }}
        />
      )}
    </div>
  )
}

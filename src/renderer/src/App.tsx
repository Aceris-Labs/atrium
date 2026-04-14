import { useCallback, useEffect, useRef, useState } from "react";
import { WorkspaceCard } from "./components/WorkspaceCard";
import { WorkspaceDetail } from "./components/WorkspaceDetail";
import { AddWorkspaceModal } from "./components/AddWorkspaceModal";
import { SettingsModal } from "./components/SettingsModal";
import { SetupWizard } from "./components/SetupWizard";
import { PRCard, PRCardSkeleton } from "./components/PRCard";
import { WingTabs } from "./components/WingTabs";
import { CreateWingModal } from "./components/CreateWingModal";
import type {
  PRStatus,
  Workspace,
  Wing,
  WorkspacePR,
  AgentSessionInfo,
} from "../../shared/types";

export default function App() {
  const [wings, setWings] = useState<Wing[]>([]);
  const [activeWingId, setActiveWingId] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [myPRs, setMyPRs] = useState<PRStatus[]>([]);
  const [reviewPRs, setReviewPRs] = useState<PRStatus[]>([]);
  const [tmuxSessions, setTmuxSessions] = useState<string[]>([]);
  const [agentStatuses, setAgentStatuses] = useState<
    Record<string, "working" | "needs-input" | "idle" | "no-session">
  >({});
  const [setupDone, setSetupDone] = useState<boolean | null>(null); // null = loading
  const [syncing, setSyncing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCreateWing, setShowCreateWing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggingPR, setDraggingPR] = useState<PRStatus | null>(null);
  const [watchedPRStatuses, setWatchedPRStatuses] = useState<PRStatus[]>([]);
  const [loadingWatched, setLoadingWatched] = useState<WorkspacePR[]>([]);
  const [linkedPRStatuses, setLinkedPRStatuses] = useState<PRStatus[]>([]);
  const [watchInput, setWatchInput] = useState("");
  const [watchError, setWatchError] = useState("");
  const syncRef = useRef(false);

  async function loadWorkspaces(wingId: string) {
    const ws = await window.api.workspaces.list(wingId);
    setWorkspaces(ws);
    fetchLinkedPRs(ws);
  }

  async function fetchLinkedPRs(workspacesList: Workspace[]) {
    const allRefs = workspacesList.flatMap((ws) => ws.prs);
    const unique = allRefs.filter(
      (p, i) =>
        allRefs.findIndex((q) => q.repo === p.repo && q.number === p.number) ===
        i,
    );
    if (unique.length === 0) return;
    const results = await Promise.all(
      unique.map((p) => window.api.github.fetchPR(p.repo, p.number)),
    );
    setLinkedPRStatuses(results.filter((r): r is PRStatus => r !== null));
  }

  const syncAll = useCallback(async (wingId: string | null) => {
    if (!wingId) return;
    if (syncRef.current) return;
    syncRef.current = true;
    setSyncing(true);
    try {
      const [prs, reviews, sessions] = await Promise.all([
        window.api.github.myPRs(wingId),
        window.api.github.reviewRequests(wingId),
        window.api.github.tmuxSessions(),
      ]);
      setMyPRs(prs);
      setReviewPRs(reviews);
      setTmuxSessions(sessions);

      // Fetch agent statuses from Claude Code session JSONL
      const ws = await window.api.workspaces.list(wingId);
      if (ws.length > 0) {
        const sessionMap: Record<string, AgentSessionInfo | undefined> = {};
        ws.forEach((w) => {
          sessionMap[w.id] = {
            tmuxSession: w.tmuxSession,
            directoryPath: w.directoryPath,
            claudeSessionId: w.claudeSessionId,
          };
        });
        const statuses = await window.api.agents.statuses(sessionMap);
        setAgentStatuses(statuses);
        // Refresh linked PR statuses so merged/closed state stays current mid-session
        fetchLinkedPRs(ws);
      }
    } finally {
      syncRef.current = false;
      setSyncing(false);
    }
  }, []);

  const pollAgents = useCallback(async (wingId: string | null) => {
    if (!wingId) return;
    const ws = await window.api.workspaces.list(wingId);
    if (ws.length > 0) {
      const sessionMap: Record<string, AgentSessionInfo | undefined> = {};
      ws.forEach((w) => {
        sessionMap[w.id] = {
          tmuxSession: w.tmuxSession,
          directoryPath: w.directoryPath,
          claudeSessionId: w.claudeSessionId,
        };
      });
      const statuses = await window.api.agents.statuses(sessionMap);
      setAgentStatuses(statuses);
    }
  }, []);

  async function loadWatched(wingId: string) {
    const watched = await window.api.watchedPRs.list(wingId);
    if (watched.length > 0) {
      const results = await Promise.all(
        watched.map((w) => window.api.github.fetchPR(w.repo, w.number)),
      );
      setWatchedPRStatuses(results.filter((r): r is PRStatus => r !== null));
    } else {
      setWatchedPRStatuses([]);
    }
  }

  async function reloadWings(): Promise<Wing[]> {
    const list = await window.api.wings.list();
    setWings(list);
    return list;
  }

  async function handleSelectWing(id: string) {
    if (id === activeWingId) return;
    setActiveWingId(id);
    setSelectedId(null);
    await window.api.wings.setActive(id);
  }

  async function handleReorderWings(newOrder: string[]) {
    setWings((prev) => {
      const byId = new Map(prev.map((w) => [w.id, w]));
      return newOrder.map((id) => byId.get(id)!).filter(Boolean);
    });
    await window.api.wings.reorder(newOrder);
  }

  async function handleRenameWing(id: string, newName: string) {
    const wing = wings.find((w) => w.id === id);
    const trimmed = newName.trim();
    if (!wing || !trimmed || trimmed === wing.name) return;
    const updated = { ...wing, name: trimmed };
    await window.api.wings.update(updated);
    setWings((prev) => prev.map((w) => (w.id === id ? updated : w)));
  }

  async function handleCreateWing(data: { name: string; rootDir?: string }) {
    const created = await window.api.wings.create(data);
    const next = await reloadWings();
    setActiveWingId(created.id);
    setShowCreateWing(false);
    await window.api.wings.setActive(created.id);
    // Data for the new wing will load via the activeWingId effect below.
    void next;
  }

  async function handleAddWatched() {
    const input = watchInput.trim();
    if (!input || !activeWingId) return;

    let repo: string;
    let number: number;

    // Try URL first
    const urlMatch = input.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
    if (urlMatch) {
      repo = urlMatch[1];
      number = parseInt(urlMatch[2], 10);
    } else {
      // Try plain number — use default repo
      const num = parseInt(input, 10);
      if (!isNaN(num) && num > 0) {
        const defaultRepo = await window.api.github.defaultRepo(activeWingId);
        if (!defaultRepo) {
          setWatchError("Set a root directory for this wing to use PR numbers");
          return;
        }
        repo = defaultRepo;
        number = num;
      } else {
        setWatchError("Enter a PR number or paste a GitHub URL");
        return;
      }
    }

    setWatchInput("");
    setWatchError("");

    // Show loading card immediately
    const prRef: WorkspacePR = { repo, number };
    setLoadingWatched((prev) => [...prev, prRef]);

    await window.api.watchedPRs.add(activeWingId, prRef);
    const status = await window.api.github.fetchPR(repo, number);

    setLoadingWatched((prev) =>
      prev.filter((p) => !(p.repo === repo && p.number === number)),
    );
    if (status) {
      setWatchedPRStatuses((prev) => {
        if (
          prev.find((p) => p.repo === status.repo && p.number === status.number)
        )
          return prev;
        return [...prev, status];
      });
    }
  }

  async function handleRemoveWatched(num: number) {
    if (!activeWingId) return;
    await window.api.watchedPRs.remove(activeWingId, num);
    loadWatched(activeWingId);
  }

  // ── Initial bootstrap ────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const c = await window.api.config.get();
      if (!c.setupComplete) {
        setSetupDone(false);
        return;
      }
      const list = await reloadWings();
      setActiveWingId(c.activeWingId ?? list[0]?.id ?? null);
      setSetupDone(true);
    })();
  }, []);

  // ── Load wing-scoped data whenever the active wing changes ───────────────
  useEffect(() => {
    if (setupDone !== true || !activeWingId) return;
    setLinkedPRStatuses([]);
    setMyPRs([]);
    setReviewPRs([]);
    setWatchedPRStatuses([]);
    loadWorkspaces(activeWingId);
    loadWatched(activeWingId);
    syncAll(activeWingId);
    const prInterval = setInterval(() => syncAll(activeWingId), 60_000);
    const agentInterval = setInterval(() => pollAgents(activeWingId), 5_000);
    return () => {
      clearInterval(prInterval);
      clearInterval(agentInterval);
    };
  }, [setupDone, activeWingId, syncAll, pollAgents]);

  async function handleAdd(
    data: Omit<Workspace, "id" | "createdAt" | "updatedAt">,
  ) {
    if (!activeWingId) return;
    const created = await window.api.workspaces.create(activeWingId, data);
    setWorkspaces((prev) => [...prev, created]);
    setShowAdd(false);
  }

  async function handleUpdate(updated: Workspace) {
    if (!activeWingId) return;
    const saved = await window.api.workspaces.update(activeWingId, updated);
    setWorkspaces((prev) => prev.map((w) => (w.id === saved.id ? saved : w)));
  }

  async function handleDropPR(workspace: Workspace, pr: PRStatus) {
    if (!pr.repo) return;
    if (workspace.prs.some((p) => p.repo === pr.repo && p.number === pr.number))
      return;
    await handleUpdate({
      ...workspace,
      prs: [...workspace.prs, { repo: pr.repo, number: pr.number }],
      // Auto-set repo from the PR if workspace doesn't have one
      ...(!workspace.repo ? { repo: pr.repo } : {}),
    });
  }

  async function handleDelete(id: string) {
    if (!activeWingId) return;
    await window.api.workspaces.delete(activeWingId, id);
    setWorkspaces((prev) => prev.filter((w) => w.id !== id));
    setSelectedId(null);
  }

  async function handleMove(id: string, toWingId: string) {
    if (!activeWingId) return;
    await window.api.workspaces.move(activeWingId, toWingId, id);
    setWorkspaces((prev) => prev.filter((w) => w.id !== id));
    setSelectedId(null);
    if (toWingId === activeWingId) {
      const updated = await window.api.workspaces.list(activeWingId);
      setWorkspaces(updated);
    }
  }

  const allPRs = [...myPRs, ...reviewPRs, ...linkedPRStatuses].reduce<
    PRStatus[]
  >((acc, pr) => {
    const idx = acc.findIndex(
      (p) => p.number === pr.number && p.repo === pr.repo,
    );
    if (idx === -1) {
      acc.push(pr);
    } else if (pr.state !== "open" && acc[idx].state === "open") {
      // Prefer merged/closed state from linkedPRStatuses over stale open entry
      acc[idx] = pr;
    }
    return acc;
  }, []);

  function prKey(pr: PRStatus): string {
    return `${pr.repo ?? ""}-${pr.number}`;
  }

  const selectedWorkspace = selectedId
    ? workspaces.find((w) => w.id === selectedId)
    : null;

  // ── Setup wizard ──────────────────────────────────────────────────────────
  if (setupDone === null) return null; // loading config
  if (setupDone === false) {
    return (
      <SetupWizard
        onComplete={async () => {
          const list = await reloadWings();
          const firstId = list[0]?.id ?? null;
          setActiveWingId(firstId);
          setSetupDone(true);
        }}
      />
    );
  }

  const activeWing = wings.find((w) => w.id === activeWingId) ?? null;

  // ── Detail view ──────────────────────────────────────────────────────────
  if (selectedWorkspace && activeWingId) {
    return (
      <div className="layout">
        <div className="titlebar">
          <button className="back-btn" onClick={() => setSelectedId(null)}>
            ← All workspaces
          </button>
          <div className="titlebar-actions">
            {syncing && <div className="spinner" />}
            <button
              className="btn btn-ghost"
              onClick={() => syncAll(activeWingId)}
            >
              Sync
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => setShowSettings(true)}
            >
              ⚙
            </button>
          </div>
        </div>
        <WorkspaceDetail
          wingId={activeWingId}
          workspace={selectedWorkspace}
          allWings={wings}
          prStatuses={allPRs}
          reviewPRNumbers={new Set(reviewPRs.map((p) => p.number))}
          watchedPRNumbers={new Set(watchedPRStatuses.map((p) => p.number))}
          myPRNumbers={new Set(myPRs.map((p) => p.number))}
          tmuxSessions={tmuxSessions}
          agentStatus={agentStatuses[selectedWorkspace.id] ?? "no-session"}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          onMove={handleMove}
          onBack={() => setSelectedId(null)}
          onRefreshSessions={async () => {
            const sessions = await window.api.github.tmuxSessions();
            setTmuxSessions(sessions);
          }}
        />
        {showSettings && activeWing && (
          <SettingsModal
            wing={activeWing}
            onClose={() => setShowSettings(false)}
            onSave={async () => {
              await reloadWings();
              syncAll(activeWingId);
            }}
            onRerunSetup={async () => {
              await window.api.config.set({ setupComplete: false });
              setSetupDone(false);
            }}
          />
        )}
      </div>
    );
  }

  // ── Dashboard ────────────────────────────────────────────────────────────
  const linkedPRKeys = new Set(
    workspaces.flatMap((w) => w.prs.map((p) => `${p.repo}-${p.number}`)),
  );
  const unlinkedReviews = reviewPRs.filter(
    (pr) => !linkedPRKeys.has(`${pr.repo ?? ""}-${pr.number}`),
  );
  const unlinkedMyPRs = myPRs.filter(
    (pr) => !linkedPRKeys.has(`${pr.repo ?? ""}-${pr.number}`),
  );
  const activeWorkspaces = workspaces.filter((w) => w.status === "active");
  const otherWorkspaces = workspaces.filter((w) => w.status !== "active");

  return (
    <div className="layout">
      <div className="titlebar">
        <span className="titlebar-title">Atrium</span>
        <WingTabs
          wings={wings}
          activeId={activeWingId}
          onSelect={handleSelectWing}
          onReorder={handleReorderWings}
          onRename={handleRenameWing}
          onCreate={() => setShowCreateWing(true)}
        />
        <div className="titlebar-actions">
          {syncing && <div className="spinner" />}
          <button
            className="btn btn-ghost"
            onClick={() => syncAll(activeWingId)}
          >
            Sync
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => setShowSettings(true)}
          >
            ⚙
          </button>
        </div>
      </div>

      <div className="content">
        {/* ── Wing header ────────────────────────────────────────── */}
        {activeWing && (
          <div className="flex items-baseline gap-3">
            <h1 className="text-[24px] font-semibold text-fg">
              {activeWing.name}
            </h1>
            {activeWing.rootDir && (
              <code className="text-sm text-fg-muted font-['SF_Mono','Fira_Code',monospace]">
                {activeWing.rootDir}
              </code>
            )}
          </div>
        )}

        {/* ── Spaces ─────────────────────────────────────────────── */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Spaces</span>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setShowAdd(true)}
            >
              + New
            </button>
          </div>
          <div className="panel-body">
            {activeWorkspaces.length > 0 && (
              <div className="section">
                <div className="section-header">
                  <span className="section-title">Active</span>
                  <span className="section-count">
                    {activeWorkspaces.length}
                  </span>
                </div>
                <div className="card-grid">
                  {activeWorkspaces.map((ws) => (
                    <WorkspaceCard
                      key={ws.id}
                      workspace={ws}
                      prStatuses={allPRs}
                      tmuxRunning={
                        ws.tmuxSession
                          ? tmuxSessions.includes(ws.tmuxSession)
                          : false
                      }
                      agentStatus={agentStatuses[ws.id] ?? "no-session"}
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
                  <span className="section-count">
                    {otherWorkspaces.length}
                  </span>
                </div>
                <div className="card-grid">
                  {otherWorkspaces.map((ws) => (
                    <WorkspaceCard
                      key={ws.id}
                      workspace={ws}
                      prStatuses={allPRs}
                      tmuxRunning={
                        ws.tmuxSession
                          ? tmuxSessions.includes(ws.tmuxSession)
                          : false
                      }
                      agentStatus={agentStatuses[ws.id] ?? "no-session"}
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
                <p>
                  Add your first space to start tracking PRs, branches, and
                  agents.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── Pull Requests ──────────────────────────────────────── */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Pull Requests</span>
            <div className="flex items-center gap-2">
              <input
                className="form-input form-input-sm"
                value={watchInput}
                onChange={(e) => {
                  setWatchInput(e.target.value);
                  setWatchError("");
                }}
                onKeyDown={(e) => e.key === "Enter" && handleAddWatched()}
                placeholder="PR # or URL"
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={handleAddWatched}
              >
                Watch
              </button>
              {watchError && (
                <span className="pr-input-error">{watchError}</span>
              )}
            </div>
          </div>
          <div className="panel-body">
            {unlinkedReviews.length > 0 && (
              <div className="section">
                <div className="section-header">
                  <span className="section-title">Needs your review</span>
                  <span className="section-count">
                    {unlinkedReviews.length}
                  </span>
                </div>
                <div className="card-grid card-grid-sm">
                  {unlinkedReviews.map((pr) => (
                    <PRCard
                      key={prKey(pr)}
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
                      key={prKey(pr)}
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
                {watchedPRStatuses.length > 0 && (
                  <span className="section-count">
                    {watchedPRStatuses.length}
                  </span>
                )}
              </div>
              {(watchedPRStatuses.length > 0 || loadingWatched.length > 0) && (
                <div className="card-grid card-grid-sm">
                  {watchedPRStatuses.map((pr) => (
                    <div key={prKey(pr)} className="detail-pr-card-wrapper">
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
                  {loadingWatched.map((p) => (
                    <PRCardSkeleton
                      key={`loading-${p.repo}-${p.number}`}
                      number={p.number}
                      repo={p.repo}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showAdd && activeWingId && (
        <AddWorkspaceModal
          defaultDirectoryPath={activeWing?.rootDir}
          onAdd={handleAdd}
          onClose={() => setShowAdd(false)}
        />
      )}
      {showCreateWing && (
        <CreateWingModal
          onCreate={handleCreateWing}
          onClose={() => setShowCreateWing(false)}
        />
      )}
      {showSettings && activeWing && (
        <SettingsModal
          wing={activeWing}
          onClose={() => setShowSettings(false)}
          onSave={async () => {
            await reloadWings();
            syncAll(activeWingId);
          }}
          onRerunSetup={async () => {
            await window.api.config.set({ setupComplete: false });
            setSetupDone(false);
          }}
        />
      )}
    </div>
  );
}

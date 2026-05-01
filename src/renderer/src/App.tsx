import { Children, useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowPathIcon,
  Cog6ToothIcon,
  ArrowLeftIcon,
} from "@heroicons/react/20/solid";
import { WorkspaceDetail } from "./components/WorkspaceDetail";
import { AddWorkspaceModal } from "./components/AddWorkspaceModal";
import { SettingsModal } from "./components/SettingsModal";
import { SetupWizard } from "./components/SetupWizard";
import { PRCard, PRCardSkeleton } from "./components/PRCard";
import { WingTabs } from "./components/WingTabs";
import { CreateWingModal } from "./components/CreateWingModal";
import { WingSummaryModal } from "./components/WingSummaryModal";
import { WatchPRModal } from "./components/WatchPRModal";
import { SpacesSidebar } from "./components/SpacesSidebar";
import { ItemsTab } from "./components/ItemsTab";
import type {
  PRStatus,
  Workspace,
  Wing,
  WorkspacePR,
  AgentSessionInfo,
  Item,
} from "../../shared/types";

type MainTab = "prs" | "items";

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
  const [setupDone, setSetupDone] = useState<boolean | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [loadingPRs, setLoadingPRs] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCreateWing, setShowCreateWing] = useState(false);
  const [showWingSummary, setShowWingSummary] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [draggingPR, setDraggingPR] = useState<PRStatus | null>(null);
  const [draggingItem, setDraggingItem] = useState<Item | null>(null);
  const [watchedPRStatuses, setWatchedPRStatuses] = useState<PRStatus[]>([]);
  const [loadingWatched, setLoadingWatched] = useState<WorkspacePR[]>([]);
  const [linkedPRStatuses, setLinkedPRStatuses] = useState<PRStatus[]>([]);
  const [showWatchModal, setShowWatchModal] = useState(false);
  const [hiddenStatusesByWing, setHiddenStatusesByWing] = useState<
    Map<string, Set<string>>
  >(new Map());
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [mainTab, setMainTab] = useState<MainTab>("prs");
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
    setLinkedPRStatuses((prev) => {
      const fresh = results.filter((r): r is PRStatus => r !== null);
      const freshKeys = new Set(fresh.map((r) => `${r.repo}-${r.number}`));
      const retained = prev.filter(
        (old) =>
          !freshKeys.has(`${old.repo}-${old.number}`) &&
          unique.some((u) => u.repo === old.repo && u.number === old.number),
      );
      return [...fresh, ...retained];
    });
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
      setLoadingPRs(false);

      const ws = await window.api.workspaces.list(wingId);
      if (ws.length > 0) {
        const sessionMap: Record<string, AgentSessionInfo | undefined> = {};
        const wing = wings.find((w) => w.id === wingId);
        ws.forEach((w) => {
          sessionMap[w.id] = {
            tmuxSession: w.tmuxSession,
            directoryPath:
              w.worktree?.path ?? wing?.projectDir ?? w.directoryPath,
            claudeSessionId: w.claudeSessionId,
          };
        });
        const statuses = await window.api.agents.statuses(sessionMap);
        setAgentStatuses(statuses);
        fetchLinkedPRs(ws);
        // Capture latest recap for each workspace with a Claude session, in
        // parallel. Persist to workspace.recap if the timestamp is newer.
        const recapResults = await Promise.all(
          ws.map(async (w) => {
            if (!w.claudeSessionId) return null;
            const r = await window.api.agents.recap(sessionMap[w.id]);
            if (!r) return null;
            // Only persist when newer than what's already stored
            if (w.recap && w.recap.capturedAt >= r.timestamp) return null;
            return {
              ...w,
              recap: { text: r.text, capturedAt: r.timestamp },
            };
          }),
        );
        const updates: Workspace[] = recapResults.filter(
          (u): u is NonNullable<typeof u> => u !== null,
        );
        if (updates.length > 0) {
          const saved = await window.api.workspaces.updateMany(
            wingId,
            updates,
          );
          setWorkspaces((prev) => {
            const byId = new Map(saved.map((w) => [w.id, w]));
            return prev.map((w) => byId.get(w.id) ?? w);
          });
        }
      }
    } finally {
      syncRef.current = false;
      setSyncing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pollAgents = useCallback(
    async (wingId: string | null) => {
      if (!wingId) return;
      const ws = await window.api.workspaces.list(wingId);
      if (ws.length > 0) {
        const sessionMap: Record<string, AgentSessionInfo | undefined> = {};
        const wing = wings.find((w) => w.id === wingId);
        ws.forEach((w) => {
          sessionMap[w.id] = {
            tmuxSession: w.tmuxSession,
            directoryPath:
              w.worktree?.path ?? wing?.projectDir ?? w.directoryPath,
            claudeSessionId: w.claudeSessionId,
          };
        });
        const statuses = await window.api.agents.statuses(sessionMap);
        setAgentStatuses(statuses);
      }
    },
    [wings],
  );

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

  async function handleDeleteWing(id: string) {
    if (wings.length <= 1) return;
    const wing = wings.find((w) => w.id === id);
    if (!confirm(`Delete wing "${wing?.name ?? id}"? This cannot be undone.`))
      return;
    await window.api.wings.delete(id);
    const remaining = wings.filter((w) => w.id !== id);
    setWings(remaining);
    if (activeWingId === id) {
      const next = remaining[0]?.id ?? null;
      setActiveWingId(next);
      if (next) await window.api.wings.setActive(next);
    }
  }

  async function handleCreateWing(data: { name: string; projectDir?: string }) {
    const created = await window.api.wings.create(data);
    await reloadWings();
    setActiveWingId(created.id);
    setShowCreateWing(false);
    await window.api.wings.setActive(created.id);
  }

  /** Returns null on success, error message otherwise. */
  async function handleWatchPR(rawInput: string): Promise<string | null> {
    const input = rawInput.trim();
    if (!input || !activeWingId) return "Pick a wing first";

    let repo: string;
    let number: number;

    const urlMatch = input.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
    if (urlMatch) {
      repo = urlMatch[1];
      number = parseInt(urlMatch[2], 10);
    } else {
      const num = parseInt(input, 10);
      if (!isNaN(num) && num > 0) {
        const defaultRepo = await window.api.github.defaultRepo(activeWingId);
        if (!defaultRepo) {
          return "Set a root directory for this wing to use PR numbers";
        }
        repo = defaultRepo;
        number = num;
      } else {
        return "Enter a PR number or paste a GitHub URL";
      }
    }

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
    return null;
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

  useEffect(() => {
    if (setupDone !== true || !activeWingId) return;
    setLinkedPRStatuses([]);
    setMyPRs([]);
    setReviewPRs([]);
    setWatchedPRStatuses([]);
    setLoadingPRs(true);
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
      ...(!workspace.repo ? { repo: pr.repo } : {}),
    });
  }

  async function handleUpdateWing(updated: Wing) {
    const saved = await window.api.wings.update(updated);
    setWings((prev) => prev.map((w) => (w.id === saved.id ? saved : w)));
  }

  async function handleDropItemOnWorkspace(
    workspace: Workspace,
    item: Item,
  ) {
    if (!activeWing) return;
    // Move item from wing.items → workspace.items
    const remaining = (activeWing.items ?? []).filter((n) => n.id !== item.id);
    await Promise.all([
      handleUpdateWing({ ...activeWing, items: remaining }),
      handleUpdate({
        ...workspace,
        items: [item, ...(workspace.items ?? [])],
      }),
    ]);
    setDraggingItem(null);
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

  function handleSelectSpace(id: string, e: React.MouseEvent) {
    if (e.metaKey || e.ctrlKey) {
      // toggle multi-select; don't open detail
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }
    setSelectedIds(new Set());
    setSelectedId(id);
    setSidebarExpanded(false);
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function bulkUpdate(patch: (ws: Workspace) => Workspace) {
    if (!activeWingId || selectedIds.size === 0) return;
    const targets = workspaces
      .filter((w) => selectedIds.has(w.id))
      .map(patch);
    const saved = await window.api.workspaces.updateMany(activeWingId, targets);
    setWorkspaces((prev) => {
      const byId = new Map(saved.map((w) => [w.id, w]));
      return prev.map((w) => byId.get(w.id) ?? w);
    });
  }

  async function bulkSetStatus(status: Workspace["status"]) {
    await bulkUpdate((ws) => ({ ...ws, status }));
  }

  async function bulkSetGroup(groupId: string | undefined) {
    await bulkUpdate((ws) => ({ ...ws, groupId }));
  }

  async function reorderWorkspaces(
    draggedId: string,
    targetId: string,
    insertBefore: boolean,
  ) {
    if (!activeWingId || draggedId === targetId) return;
    const ids = workspaces.map((w) => w.id);
    const fromIdx = ids.indexOf(draggedId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    ids.splice(fromIdx, 1);
    const adjustedTarget = fromIdx < toIdx ? toIdx - 1 : toIdx;
    ids.splice(insertBefore ? adjustedTarget : adjustedTarget + 1, 0, draggedId);
    setWorkspaces((prev) => {
      const byId = new Map(prev.map((w) => [w.id, w]));
      return ids.map((id) => byId.get(id)!).filter(Boolean);
    });
    try {
      await window.api.workspaces.reorder(activeWingId, ids);
    } catch (e) {
      console.error("Reorder failed", e);
      alert(
        "Reorder failed: " + (e instanceof Error ? e.message : String(e)),
      );
      // Roll back local state by re-listing from disk
      const fresh = await window.api.workspaces.list(activeWingId);
      setWorkspaces(fresh);
    }
  }

  async function bulkDelete() {
    if (!activeWingId || selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    try {
      await window.api.workspaces.deleteMany(activeWingId, ids);
    } catch (e) {
      console.error("Bulk delete failed", e);
      alert(
        "Delete failed: " + (e instanceof Error ? e.message : String(e)),
      );
      return;
    }
    setWorkspaces((prev) => prev.filter((w) => !selectedIds.has(w.id)));
    if (selectedId && selectedIds.has(selectedId)) setSelectedId(null);
    setSelectedIds(new Set());
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

  if (setupDone === null) return null;
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
  const hiddenStatuses = activeWingId
    ? (hiddenStatusesByWing.get(activeWingId) ?? new Set<string>())
    : new Set<string>();

  function setHiddenStatuses(next: Set<string>) {
    if (!activeWingId) return;
    setHiddenStatusesByWing((prev) => new Map(prev).set(activeWingId, next));
  }

  const openReviews = reviewPRs.filter((pr) => pr.state === "open");
  const openMyPRs = myPRs.filter((pr) => pr.state === "open");

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
          onDelete={handleDeleteWing}
          onCreate={() => setShowCreateWing(true)}
        />
        <div className="titlebar-actions">
          {selectedWorkspace && (
            <button
              className="btn btn-ghost flex items-center gap-1"
              onClick={() => setSelectedId(null)}
              title="Close space"
            >
              <ArrowLeftIcon className="w-4 h-4" />
              Close space
            </button>
          )}
          <button
            className="btn btn-ghost flex items-center gap-1"
            onClick={() => syncAll(activeWingId)}
            title="Sync"
          >
            <ArrowPathIcon
              className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`}
            />
            Sync
          </button>
          <button
            className="btn btn-ghost flex items-center justify-center"
            onClick={() => setShowSettings(true)}
            title="Settings"
          >
            <Cog6ToothIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {activeWing && (
        <div className="flex items-baseline gap-3 px-8 pt-6 pb-4 shrink-0 border-b border-line">
          <h1 className="text-[24px] font-semibold text-fg">
            {activeWing.name}
          </h1>
          {activeWing.projectDir && (
            <code className="text-sm text-fg-muted font-['SF_Mono','Fira_Code',monospace]">
              {activeWing.projectDir}
            </code>
          )}
          <button
            className="btn btn-ghost btn-sm ml-auto self-center"
            onClick={() => setShowWingSummary(true)}
            title="AI summary of this wing's spaces"
          >
            Summarize wing
          </button>
        </div>
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <SpacesSidebar
          wing={activeWing}
          workspaces={workspaces}
          prStatuses={allPRs}
          tmuxSessions={tmuxSessions}
          agentStatuses={agentStatuses}
          hiddenStatuses={hiddenStatuses}
          expanded={sidebarExpanded}
          onToggleExpanded={() => setSidebarExpanded((p) => !p)}
          onToggleStatus={(status) => {
            const next = new Set(hiddenStatuses);
            if (next.has(status)) next.delete(status);
            else next.add(status);
            setHiddenStatuses(next);
          }}
          onResetStatuses={setHiddenStatuses}
          onSelect={handleSelectSpace}
          onAddSpace={() => setShowAdd(true)}
          onUpdateWorkspace={handleUpdate}
          onUpdateWing={handleUpdateWing}
          draggingPR={draggingPR}
          onDropPR={handleDropPR}
          draggingItem={draggingItem}
          onDropItem={handleDropItemOnWorkspace}
          selectedIds={selectedIds}
          onClearSelection={clearSelection}
          onBulkSetStatus={bulkSetStatus}
          onBulkSetGroup={bulkSetGroup}
          onBulkDelete={bulkDelete}
          onReorderWorkspace={reorderWorkspaces}
          onBulkUngroupSpaces={async (ids) => {
            if (!activeWingId) return;
            const targets = workspaces
              .filter((w) => ids.includes(w.id))
              .map((w) => ({ ...w, groupId: undefined }));
            const saved = await window.api.workspaces.updateMany(
              activeWingId,
              targets,
            );
            setWorkspaces((prev) => {
              const byId = new Map(saved.map((w) => [w.id, w]));
              return prev.map((w) => byId.get(w.id) ?? w);
            });
          }}
        />

        {!sidebarExpanded && (
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            {selectedWorkspace && activeWingId ? (
              <div className="flex-1 overflow-y-auto">
                <WorkspaceDetail
                  wingId={activeWingId}
                  workspace={selectedWorkspace}
                  allWings={wings}
                  prStatuses={allPRs}
                  reviewPRNumbers={new Set(reviewPRs.map((p) => p.number))}
                  watchedPRNumbers={
                    new Set(watchedPRStatuses.map((p) => p.number))
                  }
                  myPRNumbers={new Set(myPRs.map((p) => p.number))}
                  tmuxSessions={tmuxSessions}
                  agentStatus={
                    agentStatuses[selectedWorkspace.id] ?? "no-session"
                  }
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                  onMove={handleMove}
                  onBack={() => setSelectedId(null)}
                  onRefreshSessions={async () => {
                    const sessions = await window.api.github.tmuxSessions();
                    setTmuxSessions(sessions);
                  }}
                />
              </div>
            ) : (
              <>
                <div className="flex border-b border-line bg-bg shrink-0 px-8">
                  <TabButton
                    active={mainTab === "prs"}
                    onClick={() => setMainTab("prs")}
                  >
                    Pull Requests
                  </TabButton>
                  <TabButton
                    active={mainTab === "items"}
                    onClick={() => setMainTab("items")}
                  >
                    Items
                  </TabButton>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <div className="max-w-[1800px] mx-auto px-8 py-5">
                    {mainTab === "prs" ? (
                      <PRsPanel
                        unlinkedReviews={openReviews}
                        unlinkedMyPRs={openMyPRs}
                        watchedPRStatuses={watchedPRStatuses}
                        loadingWatched={loadingWatched}
                        loading={loadingPRs}
                        draggingPR={draggingPR}
                        setDraggingPR={setDraggingPR}
                        onWatchClick={() => setShowWatchModal(true)}
                        onRemoveWatched={handleRemoveWatched}
                        prKey={prKey}
                      />
                    ) : (
                      <div className="h-[calc(100vh-260px)] min-h-[400px]">
                        <ItemsTab
                          items={activeWing?.items ?? []}
                          onChange={(items) => {
                            if (!activeWing) return;
                            handleUpdateWing({ ...activeWing, items });
                          }}
                          emptyMessage="No global items yet. Drag one onto a space to attach it."
                          onItemDragStart={(item) => setDraggingItem(item)}
                          onItemDragEnd={() => setDraggingItem(null)}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {showAdd && activeWingId && (
        <AddWorkspaceModal
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
      {showWingSummary && (
        <WingSummaryModal
          workspaces={workspaces}
          wing={activeWing}
          onClose={() => setShowWingSummary(false)}
        />
      )}
      {showWatchModal && (
        <WatchPRModal
          onWatch={handleWatchPR}
          onClose={() => setShowWatchModal(false)}
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

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`px-5 py-4 text-sm font-bold uppercase tracking-[0.08em] border-b-[3px] -mb-px transition-colors ${
        active
          ? "text-fg border-blue"
          : "text-fg-muted border-transparent hover:text-fg"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

interface PRsPanelProps {
  unlinkedReviews: PRStatus[];
  unlinkedMyPRs: PRStatus[];
  watchedPRStatuses: PRStatus[];
  loadingWatched: WorkspacePR[];
  loading: boolean;
  draggingPR: PRStatus | null;
  setDraggingPR: (pr: PRStatus | null) => void;
  onWatchClick: () => void;
  onRemoveWatched: (num: number) => void;
  prKey: (pr: PRStatus) => string;
}

function PRsPanel({
  unlinkedReviews,
  unlinkedMyPRs,
  watchedPRStatuses,
  loadingWatched,
  loading,
  draggingPR,
  setDraggingPR,
  onWatchClick,
  onRemoveWatched,
  prKey,
}: PRsPanelProps) {
  return (
    <div className="flex flex-col gap-7">
      <PRSection
        title="Needs your review"
        count={loading ? undefined : unlinkedReviews.length}
        loading={loading}
        emptyMessage="No PRs are waiting for your review."
      >
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
      </PRSection>

      <PRSection
        title="My open PRs"
        count={loading ? undefined : unlinkedMyPRs.length}
        loading={loading}
        emptyMessage="You don't have any open PRs in this wing."
      >
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
      </PRSection>

      <PRSection
        title="Watching"
        count={watchedPRStatuses.length || undefined}
        loading={false}
        emptyMessage="No PRs being watched. Click + Watch PR to track one."
        action={
          <button className="btn btn-primary btn-sm" onClick={onWatchClick}>
            + Watch PR
          </button>
        }
      >
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
              onClick={() => onRemoveWatched(pr.number)}
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
      </PRSection>
    </div>
  );
}

function PRSection({
  title,
  count,
  loading,
  emptyMessage,
  action,
  children,
}: {
  title: string;
  count?: number;
  loading?: boolean;
  emptyMessage?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  // Children.toArray flattens nested arrays (e.g. two `arr.map(...)` siblings)
  // and skips null/false, so empty maps don't read as "has children".
  const hasChildren = Children.toArray(children).length > 0;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <span className="text-base font-bold text-fg-muted uppercase tracking-[0.08em]">
          {title}
        </span>
        {count !== undefined && (
          <span className="section-count">{count}</span>
        )}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {loading && !hasChildren ? (
        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(300px,1fr))] auto-rows-fr">
          {Array.from({ length: 4 }).map((_, i) => (
            <PRCardSkeleton key={i} />
          ))}
        </div>
      ) : hasChildren ? (
        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(300px,1fr))] auto-rows-fr">
          {children}
        </div>
      ) : (
        <div className="border border-dashed border-line rounded-md py-6 px-4 text-sm text-fg-muted text-center">
          {emptyMessage ?? "Nothing here yet."}
        </div>
      )}
    </div>
  );
}

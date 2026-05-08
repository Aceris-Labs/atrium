import { Children, useEffect, useMemo, useRef, useState } from "react";
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
import { Inbox, inboxKey } from "./components/Inbox";
import {
  awaitingThreadsToInbox,
  buildPRWorkspaceMap,
} from "./components/inboxMappers";
import { WingTabs } from "./components/WingTabs";
import { CreateWingModal } from "./components/CreateWingModal";
import { WingSummaryModal } from "./components/WingSummaryModal";
import { WatchPRModal } from "./components/WatchPRModal";
import { SpacesSidebar } from "./components/SpacesSidebar";
import { ItemsTab } from "./components/ItemsTab";
import { usePRsByTag } from "./store/selectors";
import type {
  PRStatus,
  Workspace,
  Wing,
  WorkspacePR,
  Item,
  WorkspaceLink,
  InboxItem,
} from "../../shared/types";

type MainTab = "inbox" | "prs" | "items";

export default function App() {
  const [wings, setWings] = useState<Wing[]>([]);
  const [activeWingId, setActiveWingId] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [setupDone, setSetupDone] = useState<boolean | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCreateWing, setShowCreateWing] = useState(false);
  const [showWingSummary, setShowWingSummary] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [draggingPR, setDraggingPR] = useState<PRStatus | null>(null);
  const [draggingItem, setDraggingItem] = useState<Item | null>(null);
  const [draggingLink, setDraggingLink] = useState<WorkspaceLink | null>(null);
  const [dismissedInbox, setDismissedInbox] = useState<Set<string>>(new Set());
  const [dragSourceWsId, setDragSourceWsId] = useState<string | null>(null);
  const [loadingWatched, setLoadingWatched] = useState<WorkspacePR[]>([]);
  const [showWatchModal, setShowWatchModal] = useState(false);
  const [hiddenStatusesByWing, setHiddenStatusesByWing] = useState<
    Map<string, Set<string>>
  >(new Map());
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [mainTab, setMainTab] = useState<MainTab>("inbox");
  const wingsRef = useRef<Wing[]>([]);
  wingsRef.current = wings;

  // PRs flow through the main-process cache; render directly from selectors.
  const myPRs = usePRsByTag(activeWingId, "mine");
  const reviewPRs = usePRsByTag(activeWingId, "review");
  const reviewedPRs = usePRsByTag(activeWingId, "reviewed");
  const watchedPRStatuses = usePRsByTag(activeWingId, "watching");

  async function loadWorkspaces(wingId: string) {
    const ws = await window.api.workspaces.list(wingId);
    setWorkspaces(ws);
  }

  async function syncAll(): Promise<void> {
    setSyncing(true);
    try {
      await window.api.cache.refreshAll();
    } finally {
      setSyncing(false);
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
    try {
      // Server-side handler triggers the watched-PRs refresher; the cache
      // (and our selectors) hydrate the new entry as soon as it lands.
      await window.api.watchedPRs.add(activeWingId, prRef);
    } finally {
      setLoadingWatched((prev) =>
        prev.filter((p) => !(p.repo === repo && p.number === number)),
      );
    }
    return null;
  }

  async function handleRemoveWatched(num: number) {
    if (!activeWingId) return;
    await window.api.watchedPRs.remove(activeWingId, num);
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
    void window.api.cache.setActiveWing(activeWingId);
    loadWorkspaces(activeWingId);
    const unsubData = window.api.events.onDataChanged(() => {
      reloadWings();
      loadWorkspaces(activeWingId);
    });
    return unsubData;
  }, [setupDone, activeWingId]);

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
    if (dragSourceWsId === workspace.id) return;
    if (workspace.prs.some((p) => p.repo === pr.repo && p.number === pr.number))
      return;
    const updates: Promise<unknown>[] = [];
    if (dragSourceWsId) {
      const source = workspaces.find((w) => w.id === dragSourceWsId);
      if (source) {
        updates.push(
          handleUpdate({
            ...source,
            prs: source.prs.filter(
              (p) => !(p.repo === pr.repo && p.number === pr.number),
            ),
          }),
        );
      }
    }
    updates.push(
      handleUpdate({
        ...workspace,
        prs: [...workspace.prs, { repo: pr.repo, number: pr.number }],
        ...(!workspace.repo ? { repo: pr.repo } : {}),
      }),
    );
    await Promise.all(updates);
    void window.api.cache.refreshLinked();
    setDragSourceWsId(null);
  }

  async function handleUpdateWing(updated: Wing) {
    const saved = await window.api.wings.update(updated);
    setWings((prev) => prev.map((w) => (w.id === saved.id ? saved : w)));
  }

  async function handleDropItemOnWorkspace(workspace: Workspace, item: Item) {
    if (!activeWing) return;
    if (dragSourceWsId === workspace.id) return;
    if ((workspace.items ?? []).some((i) => i.id === item.id)) return;

    const updates: Promise<unknown>[] = [];
    if (dragSourceWsId) {
      const source = workspaces.find((w) => w.id === dragSourceWsId);
      if (source) {
        updates.push(
          handleUpdate({
            ...source,
            items: (source.items ?? []).filter((i) => i.id !== item.id),
          }),
        );
      }
    } else {
      // No source workspace → item came from the wing-level inbox.
      const remaining = (activeWing.items ?? []).filter(
        (n) => n.id !== item.id,
      );
      updates.push(handleUpdateWing({ ...activeWing, items: remaining }));
    }
    updates.push(
      handleUpdate({
        ...workspace,
        items: [item, ...(workspace.items ?? [])],
      }),
    );
    await Promise.all(updates);
    setDraggingItem(null);
    setDragSourceWsId(null);
  }

  async function handleDropLinkOnWorkspace(
    workspace: Workspace,
    link: WorkspaceLink,
  ) {
    // Links always live on a workspace — no inbox source.
    if (!dragSourceWsId || dragSourceWsId === workspace.id) return;
    if ((workspace.links ?? []).some((l) => l.id === link.id)) return;
    const source = workspaces.find((w) => w.id === dragSourceWsId);
    if (!source) return;
    await Promise.all([
      handleUpdate({
        ...source,
        links: (source.links ?? []).filter((l) => l.id !== link.id),
      }),
      handleUpdate({
        ...workspace,
        links: [link, ...(workspace.links ?? [])],
      }),
    ]);
    setDraggingLink(null);
    setDragSourceWsId(null);
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
    const targets = workspaces.filter((w) => selectedIds.has(w.id)).map(patch);
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
    ids.splice(
      insertBefore ? adjustedTarget : adjustedTarget + 1,
      0,
      draggedId,
    );
    setWorkspaces((prev) => {
      const byId = new Map(prev.map((w) => [w.id, w]));
      return ids.map((id) => byId.get(id)!).filter(Boolean);
    });
    try {
      await window.api.workspaces.reorder(activeWingId, ids);
    } catch (e) {
      console.error("Reorder failed", e);
      alert("Reorder failed: " + (e instanceof Error ? e.message : String(e)));
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
      alert("Delete failed: " + (e instanceof Error ? e.message : String(e)));
      return;
    }
    setWorkspaces((prev) => prev.filter((w) => !selectedIds.has(w.id)));
    if (selectedId && selectedIds.has(selectedId)) setSelectedId(null);
    setSelectedIds(new Set());
  }

  function prKey(pr: PRStatus): string {
    return `${pr.repo ?? ""}-${pr.number}`;
  }

  // Map prKey → space title for the "in space" badge on PR cards.
  const prSpaceTitles = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of workspaces) {
      for (const p of w.prs) {
        m.set(`${p.repo}-${p.number}`, w.title);
      }
    }
    return m;
  }, [workspaces]);

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

  // Inbox items aggregated from every connector source. For now only GitHub
  // awaiting-reply threads — Notion/Linear/etc. mappers slot in here later.
  const inboxItems: InboxItem[] = (() => {
    const reviewedOpen = reviewedPRs.filter((pr) => pr.state === "open");
    const prWsMap = buildPRWorkspaceMap(workspaces);
    const all = awaitingThreadsToInbox(
      [...openReviews, ...openMyPRs, ...reviewedOpen],
      prWsMap,
    );
    return all.filter((it) => !dismissedInbox.has(inboxKey(it)));
  })();

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
            onClick={() => syncAll()}
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
          draggingLink={draggingLink}
          onDropLink={handleDropLinkOnWorkspace}
          dragSourceWorkspaceId={dragSourceWsId}
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
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                  onMove={handleMove}
                  onBack={() => setSelectedId(null)}
                  onPRDragStart={(pr) => {
                    setDraggingPR(pr);
                    setDragSourceWsId(selectedWorkspace.id);
                  }}
                  onPRDragEnd={() => {
                    setDraggingPR(null);
                    setDragSourceWsId(null);
                  }}
                  onItemDragStart={(item) => {
                    setDraggingItem(item);
                    setDragSourceWsId(selectedWorkspace.id);
                  }}
                  onItemDragEnd={() => {
                    setDraggingItem(null);
                    setDragSourceWsId(null);
                  }}
                  onLinkDragStart={(link) => {
                    setDraggingLink(link);
                    setDragSourceWsId(selectedWorkspace.id);
                  }}
                  onLinkDragEnd={() => {
                    setDraggingLink(null);
                    setDragSourceWsId(null);
                  }}
                />
              </div>
            ) : (
              <>
                <div className="flex border-b border-line bg-bg shrink-0 px-8">
                  <TabButton
                    active={mainTab === "inbox"}
                    onClick={() => setMainTab("inbox")}
                    count={inboxItems.length || undefined}
                  >
                    Inbox
                  </TabButton>
                  <TabButton
                    active={mainTab === "prs"}
                    onClick={() => setMainTab("prs")}
                  >
                    PRs
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
                    {mainTab === "inbox" ? (
                      <Inbox
                        items={inboxItems}
                        onDismiss={(item) => {
                          const key = inboxKey(item);
                          setDismissedInbox((prev) => {
                            const next = new Set(prev);
                            next.add(key);
                            return next;
                          });
                        }}
                      />
                    ) : mainTab === "prs" ? (
                      <PRsPanel
                        unlinkedReviews={openReviews}
                        unlinkedMyPRs={openMyPRs}
                        reviewedPRs={reviewedPRs.filter(
                          (pr) => pr.state === "open",
                        )}
                        watchedPRStatuses={watchedPRStatuses}
                        loadingWatched={loadingWatched}
                        draggingPR={draggingPR}
                        setDraggingPR={setDraggingPR}
                        onWatchClick={() => setShowWatchModal(true)}
                        onRemoveWatched={handleRemoveWatched}
                        prKey={prKey}
                        spaceTitleFor={(pr) => prSpaceTitles.get(prKey(pr))}
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
            syncAll();
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
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <button
      className={`px-5 py-4 text-sm font-bold uppercase tracking-[0.08em] border-b-[3px] -mb-px transition-colors inline-flex items-center gap-2 ${
        active
          ? "text-fg border-blue"
          : "text-fg-muted border-transparent hover:text-fg"
      }`}
      onClick={onClick}
    >
      {children}
      {count !== undefined && count > 0 && (
        <span
          className={`text-[10px] font-semibold rounded-sm px-[6px] py-px ${
            active ? "bg-blue text-bg" : "bg-bg-input text-fg-muted"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

interface PRsPanelProps {
  unlinkedReviews: PRStatus[];
  unlinkedMyPRs: PRStatus[];
  reviewedPRs: PRStatus[];
  watchedPRStatuses: PRStatus[];
  loadingWatched: WorkspacePR[];
  draggingPR: PRStatus | null;
  setDraggingPR: (pr: PRStatus | null) => void;
  onWatchClick: () => void;
  onRemoveWatched: (num: number) => void;
  prKey: (pr: PRStatus) => string;
  spaceTitleFor: (pr: PRStatus) => string | undefined;
}

function PRsPanel({
  unlinkedReviews,
  unlinkedMyPRs,
  reviewedPRs,
  watchedPRStatuses,
  loadingWatched,
  draggingPR,
  setDraggingPR,
  onWatchClick,
  onRemoveWatched,
  prKey,
  spaceTitleFor,
}: PRsPanelProps) {
  return (
    <div className="flex flex-col gap-7">
      <PRSection
        title="Needs your review"
        count={unlinkedReviews.length}
        emptyMessage="No PRs are waiting for your review."
      >
        {unlinkedReviews.map((pr) => (
          <PRCard
            key={prKey(pr)}
            pr={pr}
            spaceTitle={spaceTitleFor(pr)}
            dragging={draggingPR?.number === pr.number}
            onDragStart={() => setDraggingPR(pr)}
            onDragEnd={() => setDraggingPR(null)}
            onClick={() => window.api.shell.openExternal(pr.url)}
          />
        ))}
      </PRSection>

      <PRSection
        title="My open PRs"
        count={unlinkedMyPRs.length}
        emptyMessage="You don't have any open PRs in this wing."
      >
        {unlinkedMyPRs.map((pr) => (
          <PRCard
            key={prKey(pr)}
            pr={pr}
            spaceTitle={spaceTitleFor(pr)}
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
              spaceTitle={spaceTitleFor(pr)}
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
  emptyMessage,
  action,
  children,
}: {
  title: string;
  count?: number;
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
        {count !== undefined && <span className="section-count">{count}</span>}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {hasChildren ? (
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

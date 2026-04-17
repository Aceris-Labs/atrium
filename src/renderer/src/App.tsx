import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { WorkspaceCard } from "./components/WorkspaceCard";
import { WorkspaceDetail } from "./components/WorkspaceDetail";
import { AddWorkspaceModal } from "./components/AddWorkspaceModal";
import { SettingsModal } from "./components/SettingsModal";
import { SetupWizard } from "./components/SetupWizard";
import { PRCard, PRCardSkeleton } from "./components/PRCard";
import { WingTabs } from "./components/WingTabs";
import { CreateWingModal } from "./components/CreateWingModal";
import { WingSummaryModal } from "./components/WingSummaryModal";
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
  const [showWingSummary, setShowWingSummary] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggingPR, setDraggingPR] = useState<PRStatus | null>(null);
  const [draggingWorkspace, setDraggingWorkspace] = useState<Workspace | null>(
    null,
  );
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const draggingGroupIdRef = useRef<string | null>(null);
  const [groupDropTarget, setGroupDropTarget] = useState<string | null>(null);
  // null = no indicator; "__end__" = after last section; else = before that section id
  const [groupInsertBefore, setGroupInsertBefore] = useState<string | null>(
    null,
  );
  const groupInsertBeforeRef = useRef<string | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [showNewGroupInput, setShowNewGroupInput] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [watchedPRStatuses, setWatchedPRStatuses] = useState<PRStatus[]>([]);
  const [loadingWatched, setLoadingWatched] = useState<WorkspacePR[]>([]);
  const [linkedPRStatuses, setLinkedPRStatuses] = useState<PRStatus[]>([]);
  const [watchInput, setWatchInput] = useState("");
  const [watchError, setWatchError] = useState("");
  const [hiddenStatuses, setHiddenStatuses] = useState<Set<string>>(new Set());
  const [showStatusFilter, setShowStatusFilter] = useState(false);
  const statusFilterRef = useRef<HTMLDivElement>(null);
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
      // Keep old data for any PR where the fetch failed (transient error) so
      // cards don't vanish and re-appear during a brief sync hiccup.
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

  useEffect(() => {
    if (!showStatusFilter) return;
    function handleMouseDown(e: MouseEvent) {
      if (
        statusFilterRef.current &&
        !statusFilterRef.current.contains(e.target as Node)
      ) {
        setShowStatusFilter(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [showStatusFilter]);

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

  const STATUS_IDS = ["active", "blocked", "done", "archived"] as const;
  type StatusId = (typeof STATUS_IDS)[number];
  const STATUS_LABELS: Record<StatusId, string> = {
    active: "Active",
    blocked: "Blocked",
    done: "Done",
    archived: "Archived",
  };

  async function handleAddGroup() {
    const name = newGroupName.trim();
    if (!name || !activeWingId) return;
    const wing = wings.find((w) => w.id === activeWingId);
    if (!wing) return;
    const id = crypto.randomUUID();
    const updatedCustomGroups = [...(wing.customGroups ?? []), { id, name }];
    const updatedGroupOrder = [...(wing.groupOrder ?? [...STATUS_IDS]), id];
    const updated = await window.api.wings.update({
      ...wing,
      customGroups: updatedCustomGroups,
      groupOrder: updatedGroupOrder,
    });
    setWings((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
    setNewGroupName("");
    setShowNewGroupInput(false);
  }

  async function handleDropWorkspaceOnGroup(
    workspace: Workspace,
    groupId: string,
  ) {
    if ((STATUS_IDS as readonly string[]).includes(groupId)) {
      await handleUpdate({
        ...workspace,
        status: groupId as StatusId,
        groupId: undefined,
      });
    } else {
      await handleUpdate({ ...workspace, groupId });
    }
  }

  async function handleReorderGroups(
    draggedId: string,
    insertBeforeId: string | null,
  ) {
    if (!activeWingId) return;
    const wing = wings.find((w) => w.id === activeWingId);
    if (!wing) return;
    const rawOrder = wing.groupOrder ?? [];
    // Normalize: ensure all status IDs are present (may be absent in legacy data)
    const order = [
      ...rawOrder,
      ...STATUS_IDS.filter((id) => !rawOrder.includes(id)),
    ];
    const from = order.indexOf(draggedId);
    if (from === -1) return;
    const next = [...order];
    next.splice(from, 1);
    if (!insertBeforeId || insertBeforeId === "__end__") {
      next.push(draggedId);
    } else {
      const to = next.indexOf(insertBeforeId);
      if (to === -1) {
        next.push(draggedId);
      } else {
        next.splice(to, 0, draggedId);
      }
    }
    const updated = await window.api.wings.update({
      ...wing,
      groupOrder: next,
    });
    setWings((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
  }

  async function handleDeleteGroup(groupId: string) {
    if (!activeWingId) return;
    const wing = wings.find((w) => w.id === activeWingId);
    if (!wing) return;
    // Move all spaces in this group back to their status group
    const spacesInGroup = workspaces.filter((w) => w.groupId === groupId);
    await Promise.all(
      spacesInGroup.map((ws) => handleUpdate({ ...ws, groupId: undefined })),
    );
    const updatedCustomGroups = (wing.customGroups ?? []).filter(
      (g) => g.id !== groupId,
    );
    const updatedGroupOrder = (wing.groupOrder ?? [...STATUS_IDS]).filter(
      (id) => id !== groupId,
    );
    const updated = await window.api.wings.update({
      ...wing,
      customGroups: updatedCustomGroups,
      groupOrder: updatedGroupOrder,
    });
    setWings((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
  }

  async function handleRenameGroup(groupId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed || !activeWingId) return;
    const wing = wings.find((w) => w.id === activeWingId);
    if (!wing) return;
    const updatedCustomGroups = (wing.customGroups ?? []).map((g) =>
      g.id === groupId ? { ...g, name: trimmed } : g,
    );
    const updated = await window.api.wings.update({
      ...wing,
      customGroups: updatedCustomGroups,
    });
    setWings((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
    setEditingGroupId(null);
    setEditingGroupName("");
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
  const customGroupMap = new Map(
    (activeWing?.customGroups ?? []).map((g) => [g.id, g]),
  );
  const rawGroupOrder = activeWing?.groupOrder ?? [];
  // Normalize: ensure all status IDs are always present, appended after any explicit order
  const groupOrder = [
    ...rawGroupOrder,
    ...STATUS_IDS.filter((id) => !rawGroupOrder.includes(id)),
  ];

  // Spaces pinned to a valid custom group
  const customGroupedIds = new Set(
    workspaces
      .filter((w) => w.groupId && customGroupMap.has(w.groupId))
      .map((w) => w.id),
  );
  const ungroupedSpaces = workspaces.filter((w) => !customGroupedIds.has(w.id));

  type GroupSection = {
    id: string;
    name: string;
    spaces: Workspace[];
    isStatus: boolean;
  };

  const groupSections: GroupSection[] = groupOrder.flatMap((gid) => {
    if ((STATUS_IDS as readonly string[]).includes(gid)) {
      if (hiddenStatuses.has(gid)) return [];
      const spaces = ungroupedSpaces.filter((w) => w.status === gid);
      if (spaces.length === 0) return [];
      return [
        {
          id: gid,
          name: STATUS_LABELS[gid as StatusId],
          spaces,
          isStatus: true,
        },
      ];
    }
    const group = customGroupMap.get(gid);
    if (!group) return [];
    const spaces = workspaces.filter(
      (w) => w.groupId === gid && !hiddenStatuses.has(w.status),
    );
    return [{ id: gid, name: group.name, spaces, isStatus: false }];
  });

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
            <div className="relative ml-3" ref={statusFilterRef}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowStatusFilter((p) => !p)}
              >
                Status
                {hiddenStatuses.size > 0 && (
                  <span className="ml-1 text-fg-muted text-xs">
                    {STATUS_IDS.length - hiddenStatuses.size}/
                    {STATUS_IDS.length}
                  </span>
                )}
                <span className="ml-1 text-fg-muted text-xs">▾</span>
              </button>
              {showStatusFilter && (
                <div className="absolute top-full left-0 mt-1 bg-bg-card border border-line rounded-md py-1 z-10 min-w-[140px] shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
                  {STATUS_IDS.map((status) => (
                    <label
                      key={status}
                      className="flex items-center gap-2 px-3 py-[6px] cursor-pointer hover:bg-bg-card-hover text-sm text-fg select-none"
                    >
                      <input
                        type="checkbox"
                        className="accent-green"
                        checked={!hiddenStatuses.has(status)}
                        onChange={() =>
                          setHiddenStatuses((prev) => {
                            const next = new Set(prev);
                            if (next.has(status)) next.delete(status);
                            else next.add(status);
                            return next;
                          })
                        }
                      />
                      {STATUS_LABELS[status]}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 ml-auto">
              {showNewGroupInput ? (
                <>
                  <input
                    className="form-input form-input-sm w-[180px]"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddGroup();
                      if (e.key === "Escape") {
                        setShowNewGroupInput(false);
                        setNewGroupName("");
                      }
                    }}
                    placeholder="Group name"
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                  />
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleAddGroup}
                  >
                    Add
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setShowNewGroupInput(false);
                      setNewGroupName("");
                    }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setShowWingSummary(true)}
                    title="AI summary of selected spaces"
                  >
                    Summarize
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setShowNewGroupInput(true)}
                  >
                    + Group
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => setShowAdd(true)}
                  >
                    + New
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="panel-body">
            {groupSections.map((section, idx) => {
              const isGroupDropTarget = groupDropTarget === section.id;
              const canDropWorkspace =
                draggingWorkspace !== null &&
                (section.isStatus
                  ? draggingWorkspace.groupId !== undefined ||
                    draggingWorkspace.status !== section.id
                  : draggingWorkspace.groupId !== section.id);
              const isDraggingGroup = draggingGroupId !== null;

              return (
                <Fragment key={section.id}>
                  {groupInsertBefore === section.id && isDraggingGroup && (
                    <div className="h-0.5 bg-blue rounded-full mx-1" />
                  )}
                  <div
                    className="section"
                    onDragOver={(e) => {
                      const draggedGroupId = draggingGroupIdRef.current;
                      if (canDropWorkspace) {
                        e.preventDefault();
                        setGroupDropTarget(section.id);
                      } else if (
                        draggedGroupId &&
                        draggedGroupId !== section.id
                      ) {
                        e.preventDefault();
                        const rect = e.currentTarget.getBoundingClientRect();
                        const inTopHalf =
                          e.clientY < rect.top + rect.height / 2;
                        const insertBefore = inTopHalf
                          ? section.id
                          : (groupSections[idx + 1]?.id ?? "__end__");
                        setGroupInsertBefore(insertBefore);
                        groupInsertBeforeRef.current = insertBefore;
                      }
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        setGroupDropTarget(null);
                        setGroupInsertBefore(null);
                        groupInsertBeforeRef.current = null;
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const draggedGroupId = draggingGroupIdRef.current;
                      if (draggingWorkspace && canDropWorkspace) {
                        handleDropWorkspaceOnGroup(
                          draggingWorkspace,
                          section.id,
                        );
                        setGroupDropTarget(null);
                      } else if (
                        draggedGroupId &&
                        draggedGroupId !== section.id
                      ) {
                        handleReorderGroups(
                          draggedGroupId,
                          groupInsertBeforeRef.current,
                        );
                        draggingGroupIdRef.current = null;
                        setDraggingGroupId(null);
                        setGroupInsertBefore(null);
                        groupInsertBeforeRef.current = null;
                      }
                    }}
                  >
                    <div
                      className="section-header cursor-grab"
                      draggable
                      onDragStart={(e) => {
                        e.stopPropagation();
                        draggingGroupIdRef.current = section.id;
                        setDraggingGroupId(section.id);
                      }}
                      onDragEnd={() => {
                        draggingGroupIdRef.current = null;
                        setDraggingGroupId(null);
                        setGroupInsertBefore(null);
                        groupInsertBeforeRef.current = null;
                      }}
                    >
                      <span className="text-fg-muted text-xs mr-1 select-none">
                        ⠿
                      </span>
                      {!section.isStatus && editingGroupId === section.id ? (
                        <input
                          className="section-title bg-transparent border-b border-line-hover outline-none w-[120px]"
                          value={editingGroupName}
                          onChange={(e) => setEditingGroupName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter")
                              handleRenameGroup(section.id, editingGroupName);
                            if (e.key === "Escape") {
                              setEditingGroupId(null);
                              setEditingGroupName("");
                            }
                          }}
                          onBlur={() =>
                            handleRenameGroup(section.id, editingGroupName)
                          }
                          // eslint-disable-next-line jsx-a11y/no-autofocus
                          autoFocus
                        />
                      ) : (
                        <span className="section-title">{section.name}</span>
                      )}
                      <span className="section-count">
                        {section.spaces.length}
                      </span>
                      {!section.isStatus && (
                        <div className="ml-auto flex items-center gap-2">
                          <button
                            className="text-fg-muted hover:text-fg text-xs leading-none"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingGroupId(section.id);
                              setEditingGroupName(section.name);
                            }}
                            title="Rename group"
                          >
                            ✎
                          </button>
                          <button
                            className="text-fg-muted hover:text-fg text-sm leading-none"
                            onClick={() => handleDeleteGroup(section.id)}
                            title="Remove group"
                          >
                            ×
                          </button>
                        </div>
                      )}
                    </div>
                    <div
                      className={`card-grid rounded-md transition-colors${isGroupDropTarget ? " outline outline-2 outline-offset-2 outline-line-hover" : ""}`}
                    >
                      {section.spaces.map((ws) => (
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
                          draggingPR={draggingWorkspace ? null : draggingPR}
                          onDrop={(pr) => handleDropPR(ws, pr)}
                          onWorkspaceDragStart={() => setDraggingWorkspace(ws)}
                          onWorkspaceDragEnd={() => {
                            setDraggingWorkspace(null);
                            setGroupDropTarget(null);
                          }}
                        />
                      ))}
                      {section.spaces.length === 0 && (
                        <div className="text-sm text-fg-muted italic py-2 px-1">
                          Drop spaces here
                        </div>
                      )}
                    </div>
                  </div>
                </Fragment>
              );
            })}
            {groupInsertBefore === "__end__" && draggingGroupId !== null && (
              <div className="h-0.5 bg-blue rounded-full mx-1" />
            )}
            {workspaces.length === 0 && groupSections.length === 0 && (
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
      {showWingSummary && (
        <WingSummaryModal
          workspaces={workspaces}
          prStatuses={allPRs}
          onClose={() => setShowWingSummary(false)}
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

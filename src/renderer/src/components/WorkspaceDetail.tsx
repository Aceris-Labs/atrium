import { useEffect, useRef, useState } from "react";
import { marked } from "marked";
import {
  PlayIcon,
  StopIcon,
  XMarkIcon,
  ArrowPathIcon,
  PlusIcon,
  TrashIcon,
} from "@heroicons/react/20/solid";
import { PRCard, PRCardSkeleton } from "./PRCard";
import { Checkbox } from "./Checkbox";
import { LinkCard } from "./LinkCard";
import { NotesSection } from "./NotesSection";
import { CreateWorktreeModal } from "./CreateWorktreeModal";
import type {
  PRStatus,
  Workspace,
  Wing,
  TodoItem,
  NoteItem,
  WorkspaceLink,
  LinkCategory,
  LinkStatus,
  GitRepoInfo,
} from "../../../shared/types";

type Tab = "overview" | "todos" | "notes" | "links" | "settings";

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

interface Props {
  wingId: string;
  workspace: Workspace;
  allWings: Wing[];
  prStatuses: PRStatus[];
  reviewPRNumbers: Set<number>;
  watchedPRNumbers: Set<number>;
  myPRNumbers: Set<number>;
  tmuxSessions: string[];
  agentStatus: "working" | "needs-input" | "idle" | "no-session";
  onUpdate: (workspace: Workspace) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, toWingId: string) => void;
  onBack: () => void;
  onRefreshSessions: () => Promise<void>;
}

function parsePRInput(input: string): { number: number; repo?: string } | null {
  const urlMatch = input.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (urlMatch) return { repo: urlMatch[1], number: parseInt(urlMatch[2], 10) };
  const num = parseInt(input, 10);
  if (!isNaN(num) && num > 0) return { number: num };
  return null;
}

function prTag(
  num: number,
  reviewPRs: Set<number>,
  watchedPRs: Set<number>,
  myPRs: Set<number>,
): "review" | "watching" | "mine" | undefined {
  if (reviewPRs.has(num)) return "review";
  if (watchedPRs.has(num)) return "watching";
  if (myPRs.has(num)) return "mine";
  return undefined;
}

export function WorkspaceDetail({
  wingId,
  workspace,
  allWings,
  prStatuses,
  reviewPRNumbers,
  watchedPRNumbers,
  myPRNumbers,
  tmuxSessions,
  agentStatus,
  onUpdate,
  onDelete,
  onMove,
  onRefreshSessions,
}: Props) {
  const todos = workspace.todos ?? [];
  const noteItems: NoteItem[] = Array.isArray(workspace.notes)
    ? workspace.notes
    : [];
  const linkItems: WorkspaceLink[] = workspace.links ?? [];

  const [todoInput, setTodoInput] = useState("");
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [editingTodoText, setEditingTodoText] = useState("");
  const [draggingTodoId, setDraggingTodoId] = useState<string | null>(null);
  const [dragOverTodoId, setDragOverTodoId] = useState<string | null>(null);
  const [linkInput, setLinkInput] = useState("");
  const [prInput, setPrInput] = useState("");
  const [prInputError, setPrInputError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [fetchedPRs, setFetchedPRs] = useState<PRStatus[]>([]);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(workspace.title);
  const [linkHydrations, setLinkHydrations] = useState<
    Record<string, LinkStatus>
  >({});
  const [hydrationPending, setHydrationPending] = useState<Set<string>>(
    new Set(),
  );
  const [availableSessions, setAvailableSessions] = useState<
    { name: string; status: string }[]
  >([]);
  const [showSessionPicker, setShowSessionPicker] = useState(false);

  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [showBranchPicker, setShowBranchPicker] = useState(false);
  const [branchRepoInfo, setBranchRepoInfo] = useState<GitRepoInfo>({
    isRepo: false,
  });
  const [branchDraft, setBranchDraft] = useState(workspace.branch ?? "");
  const [showCreateWorktree, setShowCreateWorktree] = useState(false);
  const [confirmDeleteWorktree, setConfirmDeleteWorktree] = useState(false);
  const [gitRemoveWorktree, setGitRemoveWorktree] = useState(false);
  const [deletingWorktree, setDeletingWorktree] = useState(false);
  const [deleteWorktreeError, setDeleteWorktreeError] = useState<string | null>(
    null,
  );

  const [aboutDraft, setAboutDraft] = useState(workspace.about ?? "");
  const [generatingDigest, setGeneratingDigest] = useState(false);
  const [actualBranch, setActualBranch] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [draggingPRKey, setDraggingPRKey] = useState<string | null>(null);
  const [prDropTarget, setPRDropTarget] = useState<{
    key: string;
    before: boolean;
  } | null>(null);
  const [recap, setRecap] = useState<{
    text: string;
    timestamp: string;
  } | null>(null);

  const titleInputRef = useRef<HTMLInputElement>(null);

  const openTodos = todos.filter((t) => !t.done);
  const ticketLinks = linkItems.filter((l) => l.category === "tickets");

  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "overview", label: "Overview" },
    { id: "todos", label: "Todos", count: openTodos.length },
    { id: "notes", label: "Notes", count: noteItems.length },
    { id: "links", label: "Links", count: linkItems.length },
    { id: "settings", label: "Settings" },
  ];

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.select();
  }, [editingTitle]);

  useEffect(() => {
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
      const allKnown = [...prStatuses, ...fetchedPRs];
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

  const linksKey = (workspace.links ?? []).map((l) => l.url).join("\0");

  useEffect(() => {
    const urls = linksKey ? linksKey.split("\0") : [];
    if (urls.length === 0) {
      setLinkHydrations({});
      setHydrationPending(new Set());
      return;
    }
    let cancelled = false;
    async function run() {
      const stale = await window.api.links.getCached(urls);
      if (!cancelled) {
        setLinkHydrations(stale);
        setHydrationPending(new Set(urls.filter((u) => !stale[u])));
      }
      try {
        const fresh = await window.api.links.hydrate(urls);
        if (!cancelled) {
          setLinkHydrations(fresh);
          setHydrationPending(new Set());
        }
      } catch {
        if (!cancelled) setHydrationPending(new Set());
      }
    }
    void run();
    const interval = setInterval(() => void run(), 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id, linksKey]);

  useEffect(() => {
    window.api.agents.sessions().then(setAvailableSessions);
  }, [workspace.id]);

  useEffect(() => {
    if (!workspace.claudeSessionId) {
      setRecap(null);
      return;
    }
    let cancelled = false;
    const info = {
      tmuxSession: workspace.tmuxSession,
      directoryPath: workspace.worktree?.path ?? wing?.projectDir,
      claudeSessionId: workspace.claudeSessionId,
    };
    async function load() {
      const r = await window.api.agents.recap(info);
      if (!cancelled) setRecap(r);
    }
    load();
    const interval = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    workspace.id,
    workspace.claudeSessionId,
    workspace.tmuxSession,
    workspace.worktree?.path,
    wing?.projectDir,
  ]);

  const wing = allWings.find((w) => w.id === wingId);
  const effectiveDir = workspace.worktree?.path ?? wing?.projectDir;

  // Show the worktree's actual current HEAD (so the header reflects shell
  // checkouts), not the saved workspace.branch field.
  useEffect(() => {
    if (!workspace.worktree?.path) {
      setActualBranch(null);
      return;
    }
    let cancelled = false;
    window.api.git.currentBranch(workspace.worktree.path).then((b) => {
      if (!cancelled) setActualBranch(b);
    });
    return () => {
      cancelled = true;
    };
  }, [workspace.id, workspace.worktree?.path, workspace.branch]);

  useEffect(() => {
    if (!showBranchPicker) return;
    if (!effectiveDir) {
      setBranchRepoInfo({ isRepo: false });
      return;
    }
    window.api.git.detectRepo(effectiveDir).then(setBranchRepoInfo);
  }, [showBranchPicker, effectiveDir]);

  function handleSaveAbout() {
    if (aboutDraft !== (workspace.about ?? "")) {
      onUpdate({ ...workspace, about: aboutDraft });
    }
  }

  async function handleGenerateDigest() {
    setGeneratingDigest(true);
    try {
      const text = await window.api.workspace.generateDigest(
        workspace,
        [...prStatuses, ...fetchedPRs],
        linkHydrations,
      );
      onUpdate({
        ...workspace,
        digest: { text, generatedAt: new Date().toISOString() },
      });
    } finally {
      setGeneratingDigest(false);
    }
  }

  async function handleRefreshLinks() {
    const urls = (workspace.links ?? []).map((l) => l.url);
    setHydrationPending(new Set(urls));
    const results = await Promise.all(
      urls.map((url) => window.api.links.refresh(url)),
    );
    const next: Record<string, LinkStatus> = {};
    urls.forEach((url, i) => (next[url] = results[i]));
    setLinkHydrations(next);
    setHydrationPending(new Set());
  }

  function commitRename() {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== workspace.title) {
      onUpdate({ ...workspace, title: trimmed });
    } else {
      setTitleDraft(workspace.title);
    }
    setEditingTitle(false);
  }

  function commitBranchCheckout(next: string) {
    if (!next || next === workspace.branch) {
      setShowBranchPicker(false);
      return;
    }
    onUpdate({ ...workspace, branch: next });
    setShowBranchPicker(false);
  }

  async function handleDeleteWorktree() {
    setDeletingWorktree(true);
    setDeleteWorktreeError(null);
    try {
      const updated = await window.api.workspace.deleteWorktree(
        wingId,
        workspace.id,
        gitRemoveWorktree,
      );
      onUpdate(updated);
      setConfirmDeleteWorktree(false);
      setGitRemoveWorktree(false);
    } catch (e) {
      setDeleteWorktreeError(
        e instanceof Error ? e.message : "Failed to remove worktree",
      );
    } finally {
      setDeletingWorktree(false);
    }
  }

  function handleAddTodo() {
    const text = todoInput.trim();
    if (!text) return;
    const todo: TodoItem = { id: Date.now().toString(36), text, done: false };
    onUpdate({ ...workspace, todos: [...todos, todo] });
    setTodoInput("");
  }

  function handleToggleTodo(id: string) {
    onUpdate({
      ...workspace,
      todos: todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    });
  }

  function handleDeleteTodo(id: string) {
    onUpdate({ ...workspace, todos: todos.filter((t) => t.id !== id) });
  }

  function handleEditTodo(id: string, text: string) {
    const trimmed = text.trim();
    if (!trimmed) {
      handleDeleteTodo(id);
      return;
    }
    onUpdate({
      ...workspace,
      todos: todos.map((t) => (t.id === id ? { ...t, text: trimmed } : t)),
    });
  }

  function handleReorderTodo(draggedId: string, targetId: string) {
    const arr = [...todos];
    const from = arr.findIndex((t) => t.id === draggedId);
    const to = arr.findIndex((t) => t.id === targetId);
    if (from === -1 || to === -1 || from === to) return;
    const [item] = arr.splice(from, 1);
    arr.splice(to, 0, item);
    onUpdate({ ...workspace, todos: arr });
  }

  function classifyUrl(url: string): {
    source: WorkspaceLink["source"];
    category: LinkCategory;
  } {
    if (url.includes("notion.so") || url.includes("notion.site"))
      return { source: "notion", category: "docs" };
    if (url.includes("linear.app"))
      return { source: "linear", category: "tickets" };
    if (url.includes("github.com"))
      return { source: "github", category: "other" };
    if (url.includes("slack.com"))
      return { source: "slack", category: "other" };
    if (url.includes("discord.com"))
      return { source: "discord", category: "other" };
    if (url.includes("figma.com")) return { source: "figma", category: "docs" };
    if (url.includes("coda.io")) return { source: "coda", category: "docs" };
    if (url.includes("atlassian.net")) {
      if (url.includes("/wiki/"))
        return { source: "confluence", category: "docs" };
      return { source: "jira", category: "tickets" };
    }
    return { source: "other", category: "other" };
  }

  function deriveLinkLabel(url: string): string {
    try {
      const u = new URL(url);
      const segments = u.pathname.split("/").filter(Boolean);
      return segments[segments.length - 1]?.replace(/[-_]/g, " ") ?? u.hostname;
    } catch {
      return url;
    }
  }

  function handleAddLink() {
    let url = linkInput.trim();
    if (!url) return;
    if (!url.startsWith("http")) url = "https://" + url;
    const { source, category } = classifyUrl(url);
    const link: WorkspaceLink = {
      id: Date.now().toString(36),
      url,
      label: deriveLinkLabel(url),
      source,
      category,
    };
    onUpdate({ ...workspace, links: [...linkItems, link] });
    setLinkInput("");
  }

  function handleDeleteLink(id: string) {
    onUpdate({ ...workspace, links: linkItems.filter((l) => l.id !== id) });
  }

  function handleFieldUpdate(fields: Partial<Workspace>) {
    onUpdate({ ...workspace, ...fields });
  }

  async function handleAddPR() {
    const parsed = parsePRInput(prInput.trim());
    if (!parsed) {
      setPrInputError("Paste a GitHub PR URL or enter a number");
      return;
    }
    let repo = parsed.repo ?? workspace.repo;
    if (!repo)
      repo = (await window.api.github.defaultRepo(wingId)) ?? undefined;
    if (!repo) {
      setPrInputError("Set a repo for this workspace or the wing first");
      return;
    }
    if (
      workspace.prs.some((p) => p.repo === repo && p.number === parsed.number)
    ) {
      setPrInputError("Already linked");
      return;
    }
    const updatedWorkspace = {
      ...workspace,
      prs: [...workspace.prs, { repo, number: parsed.number }],
      ...(!workspace.repo ? { repo } : {}),
    };
    onUpdate(updatedWorkspace);
    setPrInput("");
    setPrInputError("");
    if (
      !allKnownPRs.find((p) => p.repo === repo && p.number === parsed.number)
    ) {
      const result = await window.api.github.fetchPR(repo, parsed.number);
      if (result) setFetchedPRs((prev) => [...prev, result]);
    }
  }

  function handleReorderPR(
    draggedKey: string,
    targetKey: string,
    insertBefore: boolean,
  ) {
    if (draggedKey === targetKey) return;
    const ordered = [...workspace.prs];
    const fromIdx = ordered.findIndex(
      (p) => `${p.repo}-${p.number}` === draggedKey,
    );
    const toIdx = ordered.findIndex(
      (p) => `${p.repo}-${p.number}` === targetKey,
    );
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = ordered.splice(fromIdx, 1);
    const adjustedTo = fromIdx < toIdx ? toIdx - 1 : toIdx;
    ordered.splice(insertBefore ? adjustedTo : adjustedTo + 1, 0, moved);
    onUpdate({ ...workspace, prs: ordered });
  }

  function handleRemovePR(repo: string, num: number) {
    onUpdate({
      ...workspace,
      prs: workspace.prs.filter((p) => !(p.repo === repo && p.number === num)),
    });
  }

  async function handleLaunch() {
    setLaunchError(null);
    try {
      const sessionName = await window.api.workspace.launch(wingId, workspace);
      if (!workspace.tmuxSession) {
        onUpdate({ ...workspace, tmuxSession: sessionName });
      }
      await onRefreshSessions();
      if (workspace.worktree?.path) {
        const b = await window.api.git.currentBranch(workspace.worktree.path);
        setActualBranch(b);
      }
    } catch (e) {
      setLaunchError(e instanceof Error ? e.message : "Launch failed");
    }
  }

  async function handleStop() {
    await window.api.workspace.stop(workspace.tmuxSession ?? workspace.id);
    await onRefreshSessions();
  }

  const allKnownPRs = [...prStatuses, ...fetchedPRs].reduce<PRStatus[]>(
    (acc, pr) => {
      if (!acc.find((p) => p.number === pr.number && p.repo === pr.repo))
        acc.push(pr);
      return acc;
    },
    [],
  );
  const knownByKey = new Map<string, PRStatus>();
  for (const pr of allKnownPRs) {
    knownByKey.set(`${pr.repo ?? ""}-${pr.number}`, pr);
  }
  // Sort linkedPRs by workspace.prs order so reordering in the UI updates
  // which one is "primary" on the workspace card.
  const linkedPRs = workspace.prs
    .map((p) => knownByKey.get(`${p.repo}-${p.number}`))
    .filter((pr): pr is PRStatus => pr !== undefined);
  const tmuxRunning = workspace.tmuxSession
    ? tmuxSessions.includes(workspace.tmuxSession)
    : false;

  return (
    <div className="flex flex-col h-full">
      {/* ── Single-row header ───────────────────────────────────── */}
      <div className="border-b border-line px-7 py-5 flex items-center gap-3 flex-wrap shrink-0">
        {/* Title */}
        {editingTitle ? (
          <input
            ref={titleInputRef}
            className="detail-title-input"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setTitleDraft(workspace.title);
                setEditingTitle(false);
              }
            }}
          />
        ) : (
          <h1
            className="text-[20px] font-semibold text-fg cursor-pointer hover:text-fg"
            onClick={() => {
              setTitleDraft(workspace.title);
              setEditingTitle(true);
            }}
            title="Click to rename"
          >
            {workspace.title}
          </h1>
        )}

        {/* Metadata chips */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Status chip */}
          <div className="relative">
            <button
              className="meta-chip"
              onClick={() => setShowStatusPicker(!showStatusPicker)}
              title="Change status"
            >
              <span className="meta-chip-label">status</span>
              <span className="flex items-center gap-1.5">
                <span
                  className={`status-dot status-${workspace.status}`}
                />
                <span className="text-fg">{workspace.status}</span>
              </span>
            </button>
            {showStatusPicker && (
              <>
                <div
                  className="gear-menu-backdrop"
                  onClick={() => setShowStatusPicker(false)}
                />
                <div
                  className="gear-menu"
                  style={{ minWidth: 140, left: 0, right: "auto" }}
                >
                  {(["active", "blocked", "done", "archived"] as const).map(
                    (s) => (
                      <button
                        key={s}
                        className={`gear-menu-item${workspace.status === s ? " selected" : ""}`}
                        onClick={() => {
                          onUpdate({ ...workspace, status: s });
                          setShowStatusPicker(false);
                        }}
                      >
                        <span className="flex items-center gap-2">
                          <span className={`status-dot status-${s}`} />
                          {s}
                        </span>
                      </button>
                    ),
                  )}
                </div>
              </>
            )}
          </div>

          {/* Type chip */}
          <div className="relative">
            <button
              className="meta-chip"
              onClick={() => setShowTypePicker(!showTypePicker)}
              title="Change type"
            >
              <span className="meta-chip-label">type</span>
              <span
                className={
                  workspace.type === "feature"
                    ? "text-blue"
                    : workspace.type === "research"
                      ? "text-purple"
                      : "text-red"
                }
              >
                {workspace.type}
              </span>
            </button>
            {showTypePicker && (
              <>
                <div
                  className="gear-menu-backdrop"
                  onClick={() => setShowTypePicker(false)}
                />
                <div
                  className="gear-menu"
                  style={{ minWidth: 120, left: 0, right: "auto" }}
                >
                  {(["feature", "research", "bug"] as const).map((t) => (
                    <button
                      key={t}
                      className={`gear-menu-item${workspace.type === t ? " selected" : ""}`}
                      onClick={() => {
                        onUpdate({ ...workspace, type: t });
                        setShowTypePicker(false);
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Branch chip — actual HEAD when worktree present; saved focus otherwise */}
          <div className="relative">
            <button
              className="meta-chip"
              onClick={() => {
                setBranchDraft(workspace.branch ?? actualBranch ?? "");
                setShowBranchPicker(!showBranchPicker);
              }}
              title={
                workspace.worktree
                  ? actualBranch
                    ? `Current HEAD in worktree (saved focus: ${workspace.branch ?? "—"})`
                    : "No git HEAD detected"
                  : "Change branch"
              }
            >
              <span className="meta-chip-label">branch</span>
              <code
                className={
                  actualBranch || workspace.branch
                    ? "text-fg"
                    : "text-fg-muted"
                }
              >
                {actualBranch ?? workspace.branch ?? "—"}
              </code>
              {workspace.worktree &&
                actualBranch &&
                workspace.branch &&
                actualBranch !== workspace.branch && (
                  <span
                    className="text-xs text-yellow"
                    title={`Diverged from saved focus '${workspace.branch}'. Launch will check out the saved branch.`}
                  >
                    ⚠
                  </span>
                )}
            </button>
            {showBranchPicker && (
              <>
                <div
                  className="gear-menu-backdrop"
                  onClick={() => setShowBranchPicker(false)}
                />
                <div
                  className="gear-menu"
                  style={{ minWidth: 200, left: 0, right: "auto" }}
                >
                  {branchRepoInfo.isRepo && branchRepoInfo.branches ? (
                    <>
                      {branchRepoInfo.branches.map((b) => (
                        <button
                          key={b}
                          className={`gear-menu-item${workspace.branch === b ? " selected" : ""}`}
                          onClick={() => commitBranchCheckout(b)}
                        >
                          {b}
                        </button>
                      ))}
                    </>
                  ) : (
                    <div className="px-2 py-2">
                      <input
                        className="detail-meta-edit-input w-full"
                        // eslint-disable-next-line jsx-a11y/no-autofocus
                        autoFocus
                        value={branchDraft}
                        onChange={(e) => setBranchDraft(e.target.value)}
                        placeholder="branch name"
                        onKeyDown={(e) => {
                          if (e.key === "Enter")
                            commitBranchCheckout(branchDraft);
                          if (e.key === "Escape") setShowBranchPicker(false);
                        }}
                      />
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Worktree chip — shown when one exists; otherwise an Add button */}
          {workspace.worktree ? (
            confirmDeleteWorktree ? (
              <span className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-xs text-fg-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={gitRemoveWorktree}
                    onChange={(e) => setGitRemoveWorktree(e.target.checked)}
                    style={{ width: 11, height: 11 }}
                  />
                  git remove
                </label>
                <button
                  className="btn btn-sm"
                  style={{
                    background: "var(--red)",
                    borderColor: "var(--red)",
                    color: "#fff",
                    fontSize: 11,
                    padding: "2px 8px",
                  }}
                  onClick={handleDeleteWorktree}
                  disabled={deletingWorktree}
                >
                  {deletingWorktree ? "…" : "Remove"}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: 11, padding: "2px 8px" }}
                  onClick={() => {
                    setConfirmDeleteWorktree(false);
                    setDeleteWorktreeError(null);
                    setGitRemoveWorktree(false);
                  }}
                >
                  Cancel
                </button>
                {deleteWorktreeError && (
                  <span className="text-xs" style={{ color: "var(--red)" }}>
                    {deleteWorktreeError}
                  </span>
                )}
              </span>
            ) : (
              <div className="meta-chip" title={workspace.worktree.path}>
                <span className="meta-chip-label">worktree</span>
                <code className="text-fg">{workspace.worktree.name}</code>
                <button
                  className="text-fg-muted hover:text-red w-4 h-4 flex items-center justify-center rounded -mr-1"
                  onClick={() => setConfirmDeleteWorktree(true)}
                  title="Remove worktree"
                >
                  <XMarkIcon className="w-3 h-3" />
                </button>
              </div>
            )
          ) : (
            <WorktreePickerButton
              wingId={wingId}
              workspace={workspace}
              projectDir={wing?.projectDir}
              onPicked={onUpdate}
              onCreateNew={() => setShowCreateWorktree(true)}
            />
          )}
        </div>

        {/* Right cluster: launch / session / agent / gear */}
        <div className="ml-auto flex items-center gap-2">
          {agentStatus !== "no-session" && (
            <div className={`agent-badge ${agentStatus}`}>
              <div className={`agent-dot ${agentStatus}`} />
              {agentStatus === "working" && "claude working"}
              {agentStatus === "needs-input" && "needs input"}
              {agentStatus === "idle" && "claude idle"}
            </div>
          )}

          <div className="session-picker-wrapper">
            <button
              className="session-picker-trigger"
              onClick={() => {
                setShowSessionPicker(!showSessionPicker);
                window.api.agents.sessions().then(setAvailableSessions);
              }}
            >
              <div className={`tmux-dot ${tmuxRunning ? "running" : ""}`} />
              {workspace.tmuxSession
                ? `tmux: ${workspace.tmuxSession}`
                : "Link session…"}
            </button>
            {showSessionPicker && (
              <>
                <div
                  className="gear-menu-backdrop"
                  onClick={() => setShowSessionPicker(false)}
                />
                <div
                  className="gear-menu"
                  style={{ minWidth: 240, right: 0, left: "auto" }}
                >
                  {availableSessions.map((s) => (
                    <button
                      key={s.name}
                      className={`gear-menu-item${workspace.tmuxSession === s.name ? " selected" : ""}`}
                      onClick={() => {
                        onUpdate({ ...workspace, tmuxSession: s.name });
                        setShowSessionPicker(false);
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <span className={`agent-dot ${s.status}`} />
                        {s.name}
                        <span
                          style={{
                            marginLeft: "auto",
                            fontSize: 10,
                            color: "var(--text-muted)",
                          }}
                        >
                          {s.status}
                        </span>
                      </span>
                    </button>
                  ))}
                  {workspace.tmuxSession && (
                    <button
                      className="gear-menu-item"
                      style={{ color: "var(--text-muted)" }}
                      onClick={() => {
                        onUpdate({ ...workspace, tmuxSession: undefined });
                        setShowSessionPicker(false);
                      }}
                    >
                      Unlink session
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          <button
            className="btn btn-primary btn-sm flex items-center gap-1"
            onClick={handleLaunch}
            title={launchError ?? "Launch this space"}
          >
            <PlayIcon className="w-3.5 h-3.5" />
            Launch
          </button>
          {launchError && (
            <span
              className="text-xs text-red max-w-[280px] truncate"
              title={launchError}
            >
              {launchError}
            </span>
          )}
          {tmuxRunning && (
            <button
              className="btn btn-ghost btn-sm flex items-center gap-1"
              style={{ color: "var(--red)", borderColor: "var(--red)33" }}
              onClick={handleStop}
              title="Stop session"
            >
              <StopIcon className="w-3.5 h-3.5" />
              Stop
            </button>
          )}

        </div>
      </div>

      {/* ── Horizontal tabs ─────────────────────────────────────── */}
      <div className="flex border-b border-line bg-bg shrink-0 px-7">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`px-5 py-4 text-sm font-bold uppercase tracking-[0.08em] border-b-[3px] -mb-px transition-colors flex items-center gap-2 ${
              activeTab === tab.id
                ? "text-fg border-blue"
                : "text-fg-muted border-transparent hover:text-fg"
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined && tab.count > 0 && (
              <span className="text-xs text-fg-muted bg-bg-input border border-line rounded-[10px] px-[7px] py-px tabular-nums">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab content ─────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1800px] mx-auto px-7 py-6">
          {activeTab === "overview" && (
            <div className="flex flex-col gap-8">
              {/* PRs */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold text-fg-muted uppercase tracking-[0.08em]">
                    Pull Requests
                  </span>
                  {workspace.prs.length > 0 && (
                    <span className="section-count">
                      {workspace.prs.length}
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <input
                      className="form-input form-input-sm"
                      value={prInput}
                      onChange={(e) => {
                        setPrInput(e.target.value);
                        setPrInputError("");
                      }}
                      onKeyDown={(e) => e.key === "Enter" && handleAddPR()}
                      placeholder="PR # or URL"
                    />
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={handleAddPR}
                    >
                      Link PR
                    </button>
                    {prInputError && (
                      <span className="pr-input-error">{prInputError}</span>
                    )}
                  </div>
                </div>
                {workspace.prs.length > 0 ? (
                  <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(300px,1fr))] auto-rows-fr">
                    {linkedPRs.map((pr) => {
                      const key = `${pr.repo ?? ""}-${pr.number}`;
                      const isDragOver =
                        draggingPRKey !== null &&
                        draggingPRKey !== key &&
                        prDropTarget?.key === key;
                      return (
                        <div
                          key={key}
                          className="detail-pr-card-wrapper relative"
                          draggable
                          onDragStart={() => setDraggingPRKey(key)}
                          onDragEnd={() => {
                            setDraggingPRKey(null);
                            setPRDropTarget(null);
                          }}
                          onDragOver={(e) => {
                            if (
                              !draggingPRKey ||
                              draggingPRKey === key
                            )
                              return;
                            e.preventDefault();
                            const rect =
                              e.currentTarget.getBoundingClientRect();
                            const before =
                              e.clientX < rect.left + rect.width / 2;
                            setPRDropTarget({ key, before });
                          }}
                          onDrop={(e) => {
                            if (!draggingPRKey || draggingPRKey === key)
                              return;
                            e.preventDefault();
                            handleReorderPR(
                              draggingPRKey,
                              key,
                              prDropTarget?.before ?? true,
                            );
                            setDraggingPRKey(null);
                            setPRDropTarget(null);
                          }}
                          style={{
                            opacity: draggingPRKey === key ? 0.4 : 1,
                          }}
                        >
                          {isDragOver && prDropTarget?.before && (
                            <div className="absolute -left-1.5 top-0 bottom-0 w-0.5 bg-blue rounded-full" />
                          )}
                          {isDragOver && !prDropTarget?.before && (
                            <div className="absolute -right-1.5 top-0 bottom-0 w-0.5 bg-blue rounded-full" />
                          )}
                          <PRCard
                            pr={pr}
                            tag={prTag(
                              pr.number,
                              reviewPRNumbers,
                              watchedPRNumbers,
                              myPRNumbers,
                            )}
                            onClick={() =>
                              window.api.shell.openExternal(pr.url)
                            }
                          />
                          <button
                            className="detail-pr-remove-overlay"
                            onClick={() =>
                              handleRemovePR(pr.repo ?? "", pr.number)
                            }
                            title="Unlink PR"
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                    {workspace.prs
                      .filter(
                        (p) =>
                          !linkedPRs.find(
                            (k) => k.repo === p.repo && k.number === p.number,
                          ),
                      )
                      .map((p) => (
                        <div
                          key={`${p.repo}-${p.number}`}
                          className="detail-pr-card-wrapper"
                        >
                          <PRCardSkeleton number={p.number} repo={p.repo} />
                          <button
                            className="detail-pr-remove-overlay"
                            onClick={() => handleRemovePR(p.repo, p.number)}
                            title="Unlink PR"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="detail-empty-text">No PRs linked yet.</p>
                )}
              </div>

              {/* Status snapshot */}
              {(todos.length > 0 || ticketLinks.length > 0) && (
                <div className="rounded-md border border-line divide-y divide-line">
                  {todos.length > 0 && (
                    <div className="flex items-center gap-3 px-4 py-3">
                      <span className="text-xs text-fg-muted w-14 shrink-0">
                        Todos
                      </span>
                      <div className="flex-1 h-1 bg-bg rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green rounded-full transition-all"
                          style={{
                            width: `${(todos.filter((t) => t.done).length / todos.length) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="text-xs text-fg-muted tabular-nums shrink-0">
                        {todos.filter((t) => t.done).length}/{todos.length} done
                      </span>
                    </div>
                  )}

                  {ticketLinks.length > 0 && (
                    <div className="flex flex-col gap-2 px-4 py-3">
                      <span className="text-xs text-fg-muted">Tickets</span>
                      {ticketLinks.map((link) => {
                        const h = linkHydrations[link.url];
                        const isLoading = hydrationPending.has(link.url);
                        return (
                          <div
                            key={link.id}
                            className="flex items-center gap-2 min-w-0 cursor-pointer"
                            onClick={() =>
                              window.api.shell.openExternal(link.url)
                            }
                          >
                            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-sm bg-bg-input border border-line text-fg-muted shrink-0">
                              {link.source}
                            </span>
                            {isLoading ? (
                              <span className="shimmer-bar flex-1" />
                            ) : (
                              <>
                                <span className="text-xs text-fg truncate flex-1">
                                  {h?.identifier
                                    ? `${h.identifier} · ${h.title || link.label}`
                                    : (h?.title ?? link.label)}
                                </span>
                                {h?.status && (
                                  <span className="text-xs px-1.5 py-0.5 rounded-sm border bg-bg-input text-fg-muted border-line shrink-0">
                                    {h.status}
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Latest recap (Claude's own session summary) */}
              {recap && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <span className="text-base font-bold text-fg-muted uppercase tracking-[0.08em]">
                      Latest recap
                    </span>
                    <span className="text-xs text-fg-muted">
                      {formatRelative(recap.timestamp)} · from Claude
                    </span>
                    <button
                      className="btn btn-ghost btn-sm ml-auto"
                      onClick={() => {
                        setAboutDraft(recap.text);
                        onUpdate({ ...workspace, about: recap.text });
                      }}
                      title="Replace About with this recap"
                    >
                      Use as About
                    </button>
                  </div>
                  <div className="rounded-md border border-line bg-bg-input px-4 py-3 text-sm text-fg leading-relaxed">
                    {recap.text}
                  </div>
                </div>
              )}

              {/* About */}
              <div className="flex flex-col gap-3">
                <span className="text-base font-bold text-fg-muted uppercase tracking-[0.08em]">
                  About
                </span>
                <textarea
                  className="w-full bg-bg-input border border-line rounded-md text-sm text-fg placeholder:text-fg-muted px-3 py-2.5 resize-none leading-relaxed outline-none focus:border-line-hover"
                  rows={5}
                  value={aboutDraft}
                  onChange={(e) => setAboutDraft(e.target.value)}
                  onBlur={handleSaveAbout}
                  placeholder="Describe what this space is working on, its goals, key decisions…"
                />
              </div>

              {/* Agent digest */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-base font-bold text-fg-muted uppercase tracking-[0.08em]">
                    Agent Digest
                  </span>
                  <div className="flex-1" />
                  {workspace.digest?.generatedAt && !generatingDigest && (
                    <span className="text-xs text-fg-muted">
                      {formatRelative(workspace.digest.generatedAt)}
                    </span>
                  )}
                  <button
                    className="btn btn-ghost btn-sm flex items-center gap-1.5"
                    onClick={handleGenerateDigest}
                    disabled={generatingDigest}
                  >
                    <ArrowPathIcon
                      className={`w-3.5 h-3.5 ${generatingDigest ? "animate-spin" : ""}`}
                    />
                    {generatingDigest
                      ? "Generating…"
                      : workspace.digest
                        ? "Regenerate"
                        : "Generate"}
                  </button>
                </div>
                {generatingDigest ? (
                  <div className="flex flex-col gap-2">
                    <span className="shimmer-bar w-full block" />
                    <span className="shimmer-bar w-4/5 block" />
                    <span className="shimmer-bar w-full block" />
                    <span className="shimmer-bar w-3/5 block" />
                  </div>
                ) : workspace.digest?.text ? (
                  <div
                    className="prose-note text-sm text-fg leading-relaxed rounded-md border border-line bg-bg-input px-4 py-3"
                    dangerouslySetInnerHTML={{
                      __html: marked.parse(workspace.digest.text) as string,
                    }}
                  />
                ) : (
                  <p className="detail-empty-text">
                    Click Generate to have Claude summarize this space's PRs,
                    todos, tickets, and notes.
                  </p>
                )}
              </div>
            </div>
          )}

          {activeTab === "todos" && (
            <div>
              <div className="todo-input-row">
                <input
                  className="todo-input"
                  value={todoInput}
                  onChange={(e) => setTodoInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddTodo()}
                  placeholder="Add a todo and press Enter…"
                />
              </div>
              <div className="todo-list">
                {todos
                  .filter((t) => !t.done)
                  .map((todo) => (
                    <div
                      key={todo.id}
                      className={`todo-item${dragOverTodoId === todo.id && draggingTodoId !== todo.id ? " drag-over" : ""}`}
                      draggable={editingTodoId !== todo.id}
                      onDragStart={() => setDraggingTodoId(todo.id)}
                      onDragEnd={() => {
                        setDraggingTodoId(null);
                        setDragOverTodoId(null);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOverTodoId(todo.id);
                      }}
                      onDrop={() => {
                        if (draggingTodoId)
                          handleReorderTodo(draggingTodoId, todo.id);
                        setDraggingTodoId(null);
                        setDragOverTodoId(null);
                      }}
                    >
                      <Checkbox
                        checked={false}
                        onChange={() => handleToggleTodo(todo.id)}
                      />
                      {editingTodoId === todo.id ? (
                        <input
                          className="todo-edit-input"
                          // eslint-disable-next-line jsx-a11y/no-autofocus
                          autoFocus
                          value={editingTodoText}
                          onChange={(e) => setEditingTodoText(e.target.value)}
                          onBlur={() => {
                            handleEditTodo(todo.id, editingTodoText);
                            setEditingTodoId(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              handleEditTodo(todo.id, editingTodoText);
                              setEditingTodoId(null);
                            }
                            if (e.key === "Escape") {
                              setEditingTodoId(null);
                            }
                          }}
                        />
                      ) : (
                        <span
                          className="todo-text"
                          onClick={() => {
                            setEditingTodoId(todo.id);
                            setEditingTodoText(todo.text);
                          }}
                        >
                          {todo.text}
                        </span>
                      )}
                      <button
                        className="todo-delete"
                        onClick={() => handleDeleteTodo(todo.id)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                {todos.some((t) => t.done) && (
                  <div className="todo-done-separator">Done</div>
                )}
                {todos
                  .filter((t) => t.done)
                  .map((todo) => (
                    <div key={todo.id} className="todo-item done">
                      <Checkbox
                        checked={true}
                        onChange={() => handleToggleTodo(todo.id)}
                      />
                      <span className="todo-text">{todo.text}</span>
                      <button
                        className="todo-delete"
                        onClick={() => handleDeleteTodo(todo.id)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {activeTab === "notes" && (
            <NotesSection
              notes={noteItems}
              onChange={(notes) => onUpdate({ ...workspace, notes })}
            />
          )}

          {activeTab === "links" && (
            <LinksTab
              links={linkItems}
              linkInput={linkInput}
              onLinkInputChange={setLinkInput}
              onAddLink={handleAddLink}
              onRefresh={handleRefreshLinks}
              hydrations={linkHydrations}
              hydrationPending={hydrationPending}
              onDelete={handleDeleteLink}
            />
          )}

          {activeTab === "settings" && (
            <div className="max-w-[600px] flex flex-col gap-7">
              <div className="grid grid-cols-2 gap-4">
                <div className="detail-field-group">
                  <label className="form-label">Status</label>
                  <select
                    className="form-select"
                    value={workspace.status}
                    onChange={(e) =>
                      handleFieldUpdate({
                        status: e.target.value as Workspace["status"],
                      })
                    }
                  >
                    <option value="active">active</option>
                    <option value="blocked">blocked</option>
                    <option value="done">done</option>
                    <option value="archived">archived</option>
                  </select>
                </div>
                <div className="detail-field-group">
                  <label className="form-label">Type</label>
                  <select
                    className="form-select"
                    value={workspace.type}
                    onChange={(e) =>
                      handleFieldUpdate({
                        type: e.target.value as Workspace["type"],
                      })
                    }
                  >
                    <option value="feature">feature</option>
                    <option value="research">research</option>
                    <option value="bug">bug</option>
                  </select>
                </div>
              </div>
              {allWings.length > 1 && (
                <div className="detail-field-group">
                  <label className="form-label">Move to wing</label>
                  <select
                    className="form-select"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) onMove(workspace.id, e.target.value);
                    }}
                  >
                    <option value="">— select wing —</option>
                    {allWings
                      .filter((w) => w.id !== wingId)
                      .map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <div className="border border-line-danger rounded-md p-4 flex flex-col gap-3">
                <div>
                  <div className="text-sm font-bold text-red uppercase tracking-[0.08em]">
                    Danger zone
                  </div>
                  <p className="text-xs text-fg-muted mt-1">
                    Deleting a space removes its notes, todos, and links from
                    Atrium. The worktree and any branches stay on disk.
                  </p>
                </div>
                {!confirmDelete ? (
                  <button
                    className="btn btn-ghost btn-sm self-start flex items-center gap-2"
                    style={{
                      color: "var(--red)",
                      borderColor: "var(--red)44",
                    }}
                    onClick={() => setConfirmDelete(true)}
                  >
                    <TrashIcon className="w-4 h-4" />
                    Delete workspace
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-fg">
                      Delete "{workspace.title}"?
                    </span>
                    <button
                      className="btn btn-sm"
                      style={{
                        background: "var(--red)",
                        borderColor: "var(--red)",
                        color: "#fff",
                      }}
                      onClick={() => onDelete(workspace.id)}
                    >
                      Delete
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setConfirmDelete(false)}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {showCreateWorktree && wing?.projectDir && (
        <CreateWorktreeModal
          wingId={wingId}
          workspace={workspace}
          projectDir={wing.projectDir}
          onCreated={(updated) => {
            onUpdate(updated);
            setShowCreateWorktree(false);
          }}
          onClose={() => setShowCreateWorktree(false)}
        />
      )}
    </div>
  );
}

// ── Links tab — flat list grouped by category ──────────────────────────────

interface LinksTabProps {
  links: WorkspaceLink[];
  linkInput: string;
  onLinkInputChange: (v: string) => void;
  onAddLink: () => void;
  onRefresh: () => void;
  hydrations: Record<string, LinkStatus>;
  hydrationPending: Set<string>;
  onDelete: (id: string) => void;
}

const LINK_GROUP_LABELS: Record<string, string> = {
  docs: "Documents",
  tickets: "Tickets",
  messaging: "Messaging",
  other: "Other",
};

function groupKey(link: WorkspaceLink): keyof typeof LINK_GROUP_LABELS {
  if (link.source === "slack" || link.source === "discord") return "messaging";
  if (link.category === "docs") return "docs";
  if (link.category === "tickets") return "tickets";
  return "other";
}

function LinksTab({
  links,
  linkInput,
  onLinkInputChange,
  onAddLink,
  onRefresh,
  hydrations,
  hydrationPending,
  onDelete,
}: LinksTabProps) {
  const grouped: Record<string, WorkspaceLink[]> = {
    docs: [],
    tickets: [],
    messaging: [],
    other: [],
  };
  for (const link of links) {
    grouped[groupKey(link)].push(link);
  }
  const groupOrder = ["docs", "tickets", "messaging", "other"] as const;
  const populatedGroups = groupOrder.filter((g) => grouped[g].length > 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <input
          className="form-input form-input-sm flex-1 max-w-[500px]"
          value={linkInput}
          onChange={(e) => onLinkInputChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onAddLink()}
          placeholder="Paste a URL — Notion, Linear, GitHub, Slack, Figma…"
        />
        <button
          className="btn btn-primary btn-sm flex items-center gap-1"
          onClick={onAddLink}
          disabled={!linkInput.trim()}
        >
          <PlusIcon className="w-3.5 h-3.5" />
          Add
        </button>
        {links.length > 0 && (
          <button
            className="btn btn-ghost btn-sm flex items-center gap-1 ml-auto"
            onClick={onRefresh}
            title="Refresh link metadata"
          >
            <ArrowPathIcon className="w-3.5 h-3.5" />
            Refresh
          </button>
        )}
      </div>

      {links.length === 0 ? (
        <p className="detail-empty-text">No links yet. Paste a URL above.</p>
      ) : (
        populatedGroups.map((group) => (
          <div key={group} className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-fg-muted uppercase tracking-[0.08em]">
                {LINK_GROUP_LABELS[group]}
              </span>
              <span className="section-count">{grouped[group].length}</span>
            </div>
            <div className="link-list">
              {grouped[group].map((link) => (
                <LinkCard
                  key={link.id}
                  link={link}
                  hydration={hydrations[link.url]}
                  isLoading={
                    hydrationPending.has(link.url) && !hydrations[link.url]
                  }
                  onDelete={() => onDelete(link.id)}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── Worktree picker (dropdown of existing + create-new footer) ─────────────

function basenameOf(p: string): string {
  return p.replace(/\/$/, "").split("/").pop() ?? p;
}

interface WorktreePickerButtonProps {
  wingId: string;
  workspace: Workspace;
  projectDir?: string;
  onPicked: (updated: Workspace) => void;
  onCreateNew: () => void;
}

function WorktreePickerButton({
  wingId,
  workspace,
  projectDir,
  onPicked,
  onCreateNew,
}: WorktreePickerButtonProps) {
  const [open, setOpen] = useState(false);
  const [worktrees, setWorktrees] = useState<
    { path: string; branch?: string; isMain: boolean }[]
  >([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !projectDir) return;
    let cancelled = false;
    setLoading(true);
    window.api.git
      .listWorktrees(projectDir)
      .then((wts) => {
        if (cancelled) return;
        setWorktrees(wts.filter((w) => !w.isMain));
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setWorktrees([]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectDir]);

  async function handlePick(wt: { path: string; branch?: string }) {
    const updated: Workspace = {
      ...workspace,
      worktree: {
        name: basenameOf(wt.path),
        path: wt.path,
        createdAt: new Date().toISOString(),
      },
      ...(wt.branch ? { branch: wt.branch } : {}),
    };
    const saved = await window.api.workspaces.update(wingId, updated);
    onPicked(saved);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        className="btn btn-ghost btn-sm flex items-center gap-1"
        onClick={() => setOpen((p) => !p)}
        title="Pick or create a worktree for this space"
      >
        <PlusIcon className="w-3.5 h-3.5" />
        Worktree
      </button>
      {open && (
        <>
          <div
            className="gear-menu-backdrop"
            onClick={() => setOpen(false)}
          />
          <div
            className="absolute top-full left-0 mt-1 z-10 bg-bg-card border border-line rounded-md shadow-[0_4px_16px_rgba(0,0,0,0.3)] flex flex-col"
            style={{ minWidth: 280, maxWidth: 420 }}
          >
            <div className="overflow-y-auto max-h-[280px] py-1">
              {loading ? (
                <div className="px-3 py-2 text-sm text-fg-muted">
                  Loading worktrees…
                </div>
              ) : worktrees.length === 0 ? (
                <div className="px-3 py-2 text-sm text-fg-muted italic">
                  No existing worktrees
                </div>
              ) : (
                worktrees.map((wt) => (
                  <button
                    key={wt.path}
                    className="w-full text-left px-3 py-2 hover:bg-bg-card-hover flex flex-col gap-0.5"
                    onClick={() => handlePick(wt)}
                  >
                    <div className="flex items-center gap-2">
                      <code className="text-sm text-fg">
                        {basenameOf(wt.path)}
                      </code>
                      {wt.branch && (
                        <span className="text-xs text-fg-muted">
                          on{" "}
                          <code className="text-fg-muted">{wt.branch}</code>
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-fg-muted truncate">
                      {wt.path}
                    </div>
                  </button>
                ))
              )}
            </div>
            <button
              className="border-t border-line px-3 py-2 text-sm text-fg-link hover:bg-bg-card-hover flex items-center gap-1.5"
              onClick={() => {
                setOpen(false);
                onCreateNew();
              }}
            >
              <PlusIcon className="w-4 h-4" />
              Create new worktree…
            </button>
          </div>
        </>
      )}
    </div>
  );
}

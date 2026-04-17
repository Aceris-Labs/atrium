import { useEffect, useRef, useState } from "react";
import { DirectoryField } from "./DirectoryField";
import { PathInput } from "./PathInput";
import { PRCard, PRCardSkeleton } from "./PRCard";
import { LinkCard } from "./LinkCard";
import { NotesSection } from "./NotesSection";
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

type Section =
  | "summary"
  | "prs"
  | "notes"
  | "todos"
  | "documents"
  | "tickets"
  | "messaging"
  | "other"
  | "settings";

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
  onBack,
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
  const [showGearMenu, setShowGearMenu] = useState(false);
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

  // Header inline-edit state
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [showBranchPicker, setShowBranchPicker] = useState(false);
  const [branchRepoInfo, setBranchRepoInfo] = useState<GitRepoInfo>({
    isRepo: false,
  });
  const [branchDraft, setBranchDraft] = useState(workspace.branch ?? "");
  const [checkingOutBranch, setCheckingOutBranch] = useState(false);
  const [branchCheckoutError, setBranchCheckoutError] = useState("");
  const [editingRepo, setEditingRepo] = useState(false);
  const [repoDraft, setRepoDraft] = useState(workspace.repo ?? "");
  const [editingDir, setEditingDir] = useState(false);
  const [dirDraft, setDirDraft] = useState(workspace.directoryPath ?? "");

  // Summary tab state
  const [aboutDraft, setAboutDraft] = useState(workspace.about ?? "");
  const [generatingDigest, setGeneratingDigest] = useState(false);

  const titleInputRef = useRef<HTMLInputElement>(null);

  // Derived link groups
  const docLinks = linkItems.filter((l) => l.category === "docs");
  const ticketLinks = linkItems.filter((l) => l.category === "tickets");
  const messagingLinks = linkItems.filter(
    (l) => l.source === "slack" || l.source === "discord",
  );
  const otherLinks = linkItems.filter(
    (l) =>
      l.category === "other" && l.source !== "slack" && l.source !== "discord",
  );
  const openTodos = todos.filter((t) => !t.done);

  const [activeSection, setActiveSection] = useState<Section>("summary");

  const navItems: { id: Section; label: string; count?: number }[] = [
    { id: "summary", label: "Summary" },
    { id: "prs", label: "Pull Requests", count: workspace.prs.length },
    { id: "todos", label: "Todos", count: openTodos.length },
    { id: "notes", label: "Notes", count: noteItems.length },
    { id: "documents", label: "Documents", count: docLinks.length },
    { id: "tickets", label: "Tickets", count: ticketLinks.length },
    { id: "messaging", label: "Messaging", count: messagingLinks.length },
    { id: "other", label: "Other", count: otherLinks.length },
    { id: "settings", label: "Settings", count: undefined },
  ];

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.select();
  }, [editingTitle]);

  useEffect(() => {
    // Cache any linked PRs currently in prStatuses so they survive a
    // temporary drop (e.g. transient fetchPR failure during sync).
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
  }, [workspace.id, workspace.prs, prStatuses]);

  // Stable key: only re-run hydration when the actual URL set changes, not on
  // every workspace save (which creates new array references even if unchanged).
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
      // Phase 1: show stale cached data immediately — no shimmer for known URLs.
      const stale = await window.api.links.getCached(urls);
      if (!cancelled) {
        setLinkHydrations(stale);
        // Shimmer only for URLs with no cache entry at all.
        setHydrationPending(new Set(urls.filter((u) => !stale[u])));
      }

      // Phase 2: hydrate in background (skips fresh URLs, fetches stale/missing).
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
    if (!showBranchPicker) return;
    const path = workspace.directoryPath?.trim();
    if (!path) {
      setBranchRepoInfo({ isRepo: false });
      return;
    }
    window.api.git.detectRepo(path).then(setBranchRepoInfo);
  }, [showBranchPicker, workspace.directoryPath]);

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

  async function commitBranchCheckout(next: string) {
    if (!next || next === workspace.branch) {
      setShowBranchPicker(false);
      setBranchCheckoutError("");
      return;
    }
    const path = workspace.directoryPath?.trim();
    if (path && branchRepoInfo.isRepo) {
      setCheckingOutBranch(true);
      setBranchCheckoutError("");
      const result = await window.api.git.checkoutBranch(path, next);
      setCheckingOutBranch(false);
      if (!result.ok) {
        setBranchCheckoutError(result.error);
        return;
      }
    }
    onUpdate({ ...workspace, branch: next });
    setShowBranchPicker(false);
  }

  function commitRepo() {
    const trimmed = repoDraft.trim();
    if (trimmed !== workspace.repo) {
      onUpdate({ ...workspace, repo: trimmed || undefined });
    }
    setEditingRepo(false);
  }

  async function commitDir() {
    const trimmed = dirDraft.trim();
    const update: Partial<Workspace> = { directoryPath: trimmed || undefined };
    if (trimmed) {
      const info = await window.api.git.detectRepo(trimmed);
      if (info.isRepo && info.currentBranch) update.branch = info.currentBranch;
    }
    onUpdate({ ...workspace, ...update });
    setEditingDir(false);
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

  function handleRemovePR(repo: string, num: number) {
    onUpdate({
      ...workspace,
      prs: workspace.prs.filter((p) => !(p.repo === repo && p.number === num)),
    });
  }

  async function handleLaunch() {
    const sessionName = await window.api.workspace.launch(wingId, workspace);
    if (!workspace.tmuxSession) {
      onUpdate({ ...workspace, tmuxSession: sessionName });
    }
    await onRefreshSessions();
    onBack();
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
  const linkedKeys = new Set(workspace.prs.map((p) => `${p.repo}-${p.number}`));
  const linkedPRs = allKnownPRs.filter((pr) =>
    linkedKeys.has(`${pr.repo ?? ""}-${pr.number}`),
  );
  const tmuxRunning = workspace.tmuxSession
    ? tmuxSessions.includes(workspace.tmuxSession)
    : false;

  return (
    <div className="detail-layout">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="detail-header">
        <div className="detail-header-main">
          {/* Status dot picker */}
          <div className="relative">
            <button
              className="card-status-dot-btn"
              onClick={() => setShowStatusPicker(!showStatusPicker)}
              title="Change status"
            >
              <span
                className={`card-status-dot ${workspace.status}`}
                style={{ width: 10, height: 10 }}
              />
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
                          <span className={`card-status-dot ${s}`} />
                          {s}
                        </span>
                      </button>
                    ),
                  )}
                </div>
              </>
            )}
          </div>
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
              className="detail-title editable"
              onClick={() => {
                setTitleDraft(workspace.title);
                setEditingTitle(true);
              }}
              title="Click to rename"
            >
              {workspace.title}
            </h1>
          )}
          {/* Type badge picker */}
          <div className="relative">
            <button
              className="card-type-badge-btn"
              onClick={() => setShowTypePicker(!showTypePicker)}
              title="Change type"
            >
              <span className={`card-type-badge ${workspace.type}`}>
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

          {/* Launch controls inline with title */}
          <div className="flex items-center gap-2 ml-4">
            <button className="btn btn-primary btn-sm" onClick={handleLaunch}>
              Launch
            </button>
            {tmuxRunning && (
              <button
                className="btn btn-ghost btn-sm"
                style={{ color: "var(--red)", borderColor: "var(--red)33" }}
                onClick={handleStop}
              >
                Stop
              </button>
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
                    style={{ minWidth: 240, left: 0, right: "auto" }}
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
            {agentStatus !== "no-session" && (
              <div className={`agent-badge ${agentStatus}`}>
                <div className={`agent-dot ${agentStatus}`} />
                {agentStatus === "working" && "claude working"}
                {agentStatus === "needs-input" && "needs input"}
                {agentStatus === "idle" && "claude idle"}
              </div>
            )}
          </div>

          <div className="gear-menu-wrapper" style={{ marginLeft: "auto" }}>
            <button
              className="gear-btn"
              onClick={() => setShowGearMenu(!showGearMenu)}
            >
              ⚙
            </button>
            {showGearMenu && (
              <>
                <div
                  className="gear-menu-backdrop"
                  onClick={() => {
                    setShowGearMenu(false);
                    setConfirmDelete(false);
                  }}
                />
                <div className="gear-menu">
                  {!confirmDelete ? (
                    <button
                      className="gear-menu-item danger"
                      onClick={() => setConfirmDelete(true)}
                    >
                      Delete workspace
                    </button>
                  ) : (
                    <div className="gear-menu-confirm">
                      <span>Delete this workspace?</span>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          className="btn"
                          style={{
                            background: "var(--red)",
                            borderColor: "var(--red)",
                            color: "#fff",
                            fontSize: 11,
                            padding: "4px 10px",
                          }}
                          onClick={() => onDelete(workspace.id)}
                        >
                          Delete
                        </button>
                        <button
                          className="btn btn-ghost"
                          style={{ fontSize: 11, padding: "4px 10px" }}
                          onClick={() => setConfirmDelete(false)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="detail-header-meta">
          {/* Branch — popover with real branch list or text input fallback */}
          <div className="relative">
            <button
              className="detail-meta-item detail-meta-item-btn"
              onClick={() => {
                setBranchDraft(workspace.branch ?? "");
                setBranchCheckoutError("");
                setShowBranchPicker(!showBranchPicker);
              }}
              title="Change branch"
            >
              <span className="detail-meta-label">branch</span>
              <code className={workspace.branch ? "" : "text-fg-muted"}>
                {workspace.branch ?? "+ branch"}
              </code>
            </button>
            {showBranchPicker && (
              <>
                <div
                  className="gear-menu-backdrop"
                  onClick={() => {
                    setShowBranchPicker(false);
                    setBranchCheckoutError("");
                  }}
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
                          disabled={checkingOutBranch}
                          onClick={() => commitBranchCheckout(b)}
                        >
                          {b}
                          {checkingOutBranch && workspace.branch !== b && (
                            <span
                              style={{
                                marginLeft: "auto",
                                fontSize: 10,
                                color: "var(--text-muted)",
                              }}
                            >
                              …
                            </span>
                          )}
                        </button>
                      ))}
                      {branchCheckoutError && (
                        <div
                          className="gear-menu-item"
                          style={{
                            color: "var(--red)",
                            cursor: "default",
                            fontSize: 11,
                          }}
                        >
                          {branchCheckoutError}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="px-2 py-2">
                      <input
                        className="detail-meta-edit-input w-full"
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

          {/* Repo — inline text input */}
          <span className="detail-meta-item">
            <span className="detail-meta-label">repo</span>
            {editingRepo ? (
              <input
                className="detail-meta-edit-input"
                autoFocus
                value={repoDraft}
                onChange={(e) => setRepoDraft(e.target.value)}
                placeholder="owner/repo"
                onBlur={commitRepo}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRepo();
                  if (e.key === "Escape") {
                    setRepoDraft(workspace.repo ?? "");
                    setEditingRepo(false);
                  }
                }}
              />
            ) : (
              <button
                className="detail-meta-value-btn"
                onClick={() => {
                  setRepoDraft(workspace.repo ?? "");
                  setEditingRepo(true);
                }}
                title="Edit repo"
              >
                <code className={workspace.repo ? "" : "text-fg-muted"}>
                  {workspace.repo ?? "+ repo"}
                </code>
              </button>
            )}
          </span>

          {/* Directory — PathInput inline */}
          <span
            className="detail-meta-item"
            style={{ flex: editingDir ? 1 : undefined }}
          >
            <span className="detail-meta-label">dir</span>
            {editingDir ? (
              <PathInput
                value={dirDraft}
                onChange={setDirDraft}
                placeholder="~/personal-projects/myproject"
                autoFocus
                onSubmit={commitDir}
                className="detail-meta-edit-input"
              />
            ) : (
              <button
                className="detail-meta-value-btn"
                onClick={() => {
                  setDirDraft(workspace.directoryPath ?? "");
                  setEditingDir(true);
                }}
                title="Edit directory"
              >
                <code
                  className={workspace.directoryPath ? "" : "text-fg-muted"}
                >
                  {workspace.directoryPath
                    ? workspace.directoryPath.replace(/^\/Users\/[^/]+/, "~")
                    : "+ directory"}
                </code>
              </button>
            )}
          </span>
        </div>
      </div>

      {/* ── Body: nav + content ─────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left nav */}
        <nav className="w-[160px] flex-shrink-0 flex flex-col border-r border-line py-3 px-2 overflow-y-auto gap-px">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveSection(item.id)}
              className={`flex items-center justify-between w-full px-3 py-[6px] rounded-sm text-sm text-left cursor-pointer border-none bg-transparent ${
                activeSection === item.id
                  ? "bg-bg-input text-fg font-medium"
                  : "text-fg-muted hover:text-fg hover:bg-bg-card-hover"
              }`}
            >
              <span>{item.label}</span>
              {item.count !== undefined && item.count > 0 && (
                <span className="text-xs text-fg-muted tabular-nums">
                  {item.count}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Section content */}
        <div className="flex-1 overflow-y-auto px-7 py-6 flex flex-col gap-6">
          {/* ── Summary ── */}
          {activeSection === "summary" && (
            <div className="flex flex-col gap-8">
              {/* Status snapshot */}
              {(workspace.prs.length > 0 ||
                todos.length > 0 ||
                ticketLinks.length > 0) && (
                <div className="rounded-md border border-line divide-y divide-line">
                  {/* Todos row */}
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

                  {/* PRs rows */}
                  {workspace.prs.length > 0 && (
                    <div className="flex flex-col gap-2 px-4 py-3">
                      <span className="text-xs text-fg-muted">
                        Pull Requests
                      </span>
                      {linkedPRs.map((pr) => (
                        <div
                          key={`${pr.repo ?? ""}-${pr.number}`}
                          className="flex items-center gap-2 min-w-0"
                        >
                          <span className="text-xs text-fg-muted tabular-nums shrink-0">
                            #{pr.number}
                          </span>
                          <span className="text-xs text-fg truncate flex-1">
                            {pr.title}
                          </span>
                          <div className="flex items-center gap-1 shrink-0">
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
                                CI
                              </span>
                            )}
                            {pr.state === "open" &&
                              pr.reviewDecision === "APPROVED" && (
                                <span className="badge review-approved">
                                  approved
                                </span>
                              )}
                            {pr.state === "open" &&
                              pr.reviewDecision === "CHANGES_REQUESTED" && (
                                <span className="badge review-changes-requested">
                                  changes
                                </span>
                              )}
                            {pr.state === "open" &&
                              pr.reviewDecision === "REVIEW_REQUIRED" && (
                                <span className="badge review-required">
                                  review
                                </span>
                              )}
                          </div>
                        </div>
                      ))}
                      {workspace.prs
                        .filter(
                          (p) =>
                            !linkedPRs.find(
                              (lp) =>
                                lp.repo === p.repo && lp.number === p.number,
                            ),
                        )
                        .map((p) => (
                          <div
                            key={`${p.repo}-${p.number}`}
                            className="flex items-center gap-2"
                          >
                            <span className="text-xs text-fg-muted tabular-nums shrink-0">
                              #{p.number}
                            </span>
                            <span className="shimmer-bar flex-1" />
                          </div>
                        ))}
                    </div>
                  )}

                  {/* Tickets rows */}
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

              {/* About — user-owned */}
              <div className="flex flex-col gap-3">
                <span className="detail-section-title">About</span>
                <textarea
                  className="w-full bg-bg-input border border-line rounded-md text-sm text-fg placeholder:text-fg-muted px-3 py-2.5 resize-none leading-relaxed outline-none focus:border-line-hover"
                  rows={5}
                  value={aboutDraft}
                  onChange={(e) => setAboutDraft(e.target.value)}
                  onBlur={handleSaveAbout}
                  placeholder="Describe what this space is working on, its goals, key decisions…"
                />
              </div>

              {/* Agent digest — AI-generated */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <span className="detail-section-title">Agent Digest</span>
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
                    {generatingDigest && (
                      <div
                        className="spinner shrink-0"
                        style={{ width: 10, height: 10, borderWidth: 1.5 }}
                      />
                    )}
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
                  <div className="text-sm text-fg leading-relaxed whitespace-pre-wrap rounded-md border border-line bg-bg-input px-4 py-3">
                    {workspace.digest.text}
                  </div>
                ) : (
                  <p className="detail-empty-text">
                    Click Generate to have Claude summarize this space's PRs,
                    todos, tickets, and notes.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ── PRs ── */}
          {activeSection === "prs" && (
            <div>
              <div className="section-header">
                <span className="detail-section-title">Pull Requests</span>
                <div className="section-header-right">
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
                <div className="detail-pr-grid">
                  {linkedPRs.map((pr) => (
                    <div
                      key={`${pr.repo ?? ""}-${pr.number}`}
                      className="detail-pr-card-wrapper"
                    >
                      <PRCard
                        pr={pr}
                        tag={prTag(
                          pr.number,
                          reviewPRNumbers,
                          watchedPRNumbers,
                          myPRNumbers,
                        )}
                        onClick={() => window.api.shell.openExternal(pr.url)}
                      />
                      <button
                        className="detail-pr-remove-overlay"
                        onClick={() => handleRemovePR(pr.repo ?? "", pr.number)}
                        title="Unlink PR"
                      >
                        ×
                      </button>
                    </div>
                  ))}
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
          )}

          {/* ── Todos ── */}
          {activeSection === "todos" && (
            <div>
              <div
                className="detail-section-title"
                style={{ marginBottom: 12 }}
              >
                Todos
              </div>
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
                      <input
                        type="checkbox"
                        className="todo-checkbox"
                        checked={false}
                        onChange={() => handleToggleTodo(todo.id)}
                      />
                      {editingTodoId === todo.id ? (
                        <input
                          className="todo-edit-input"
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
                      <input
                        type="checkbox"
                        className="todo-checkbox"
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

          {/* ── Notes ── */}
          {activeSection === "notes" && (
            <div>
              <div className="section-header">
                <span className="detail-section-title">Notes</span>
              </div>
              <NotesSection
                notes={noteItems}
                onChange={(notes) => onUpdate({ ...workspace, notes })}
              />
            </div>
          )}

          {/* ── Link sections (Documents / Tickets / Messaging / Other) ── */}
          {(activeSection === "documents" ||
            activeSection === "tickets" ||
            activeSection === "messaging" ||
            activeSection === "other") && (
            <LinkSection
              label={
                activeSection === "documents"
                  ? "Documents"
                  : activeSection === "tickets"
                    ? "Tickets"
                    : activeSection === "messaging"
                      ? "Messaging"
                      : "Other"
              }
              items={
                activeSection === "documents"
                  ? docLinks
                  : activeSection === "tickets"
                    ? ticketLinks
                    : activeSection === "messaging"
                      ? messagingLinks
                      : otherLinks
              }
              linkInput={linkInput}
              onLinkInputChange={setLinkInput}
              onAddLink={handleAddLink}
              onRefresh={handleRefreshLinks}
              hydrations={linkHydrations}
              hydrationPending={hydrationPending}
              onDelete={handleDeleteLink}
            />
          )}

          {/* ── Settings ── */}
          {activeSection === "settings" && (
            <div>
              <div
                className="detail-section-title"
                style={{ marginBottom: 16 }}
              >
                Settings
              </div>
              <div className="detail-config-grid">
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
              <div className="detail-field-group" style={{ marginTop: 10 }}>
                <label className="form-label">Directory</label>
                <DirectoryField
                  directoryPath={workspace.directoryPath}
                  branch={workspace.branch}
                  onChange={(next) => {
                    const update: Partial<Workspace> = {};
                    if ("directoryPath" in next)
                      update.directoryPath = next.directoryPath;
                    if ("branch" in next) update.branch = next.branch;
                    if (Object.keys(update).length > 0)
                      handleFieldUpdate(update);
                  }}
                />
              </div>
              {allWings.length > 1 && (
                <div className="detail-field-group" style={{ marginTop: 10 }}>
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Link section (shared by Documents / Tickets / Messaging / Other) ───────────

interface LinkSectionProps {
  label: string;
  items: WorkspaceLink[];
  linkInput: string;
  onLinkInputChange: (v: string) => void;
  onAddLink: () => void;
  onRefresh: () => void;
  hydrations: Record<string, LinkStatus>;
  hydrationPending: Set<string>;
  onDelete: (id: string) => void;
}

function LinkSection({
  label,
  items,
  linkInput,
  onLinkInputChange,
  onAddLink,
  onRefresh,
  hydrations,
  hydrationPending,
  onDelete,
}: LinkSectionProps) {
  return (
    <div>
      <div className="section-header">
        <span className="detail-section-title">{label}</span>
        <div className="section-header-right">
          {items.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onRefresh}
              title="Refresh link metadata"
            >
              ↻
            </button>
          )}
          <input
            className="form-input form-input-sm"
            value={linkInput}
            onChange={(e) => onLinkInputChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onAddLink()}
            placeholder="Paste a URL…"
          />
        </div>
      </div>
      {items.length > 0 ? (
        <div className="link-list">
          {items.map((link) => (
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
      ) : (
        <p className="detail-empty-text">
          No {label.toLowerCase()} linked yet.
        </p>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { DirectoryField } from "./DirectoryField";
import { PRCard } from "./PRCard";
import type {
  PRStatus,
  Workspace,
  TodoItem,
  NoteItem,
  WorkspaceLink,
  LinkCategory,
  LinkStatus,
  LinkStatusKind,
} from "../../../shared/types";

interface Props {
  wingId: string;
  workspace: Workspace;
  prStatuses: PRStatus[];
  reviewPRNumbers: Set<number>;
  watchedPRNumbers: Set<number>;
  myPRNumbers: Set<number>;
  tmuxSessions: string[];
  agentStatus: "working" | "needs-input" | "idle" | "no-session";
  onUpdate: (workspace: Workspace) => void;
  onDelete: (id: string) => void;
  onBack: () => void;
  onRefreshSessions: () => Promise<void>;
}

function parsePRInput(input: string): { number: number; repo?: string } | null {
  // Full GitHub URL: https://github.com/owner/repo/pull/123
  const urlMatch = input.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (urlMatch) return { repo: urlMatch[1], number: parseInt(urlMatch[2], 10) };

  // Plain number
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
  prStatuses,
  reviewPRNumbers,
  watchedPRNumbers,
  myPRNumbers,
  tmuxSessions,
  agentStatus,
  onUpdate,
  onDelete,
  onBack,
  onRefreshSessions,
}: Props) {
  const todos = workspace.todos ?? [];
  const noteItems: NoteItem[] = Array.isArray(workspace.notes)
    ? workspace.notes
    : [];
  const linkItems: WorkspaceLink[] = workspace.links ?? [];
  const [todoInput, setTodoInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [linkInput, setLinkInput] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");
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
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.select();
  }, [editingTitle]);

  function commitRename() {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== workspace.title) {
      onUpdate({ ...workspace, title: trimmed });
    } else {
      setTitleDraft(workspace.title);
    }
    setEditingTitle(false);
  }

  // Fetch any linked PRs not covered by the global sync
  useEffect(() => {
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

  // Hydrate link metadata on mount and every 5 min. Cached entries come
  // back immediately so the UI doesn't flash empty.
  useEffect(() => {
    const urls = (workspace.links ?? []).map((l) => l.url);
    if (urls.length === 0) {
      setLinkHydrations({});
      return;
    }
    let cancelled = false;
    async function run() {
      const result = await window.api.links.hydrate(urls);
      if (!cancelled) setLinkHydrations(result);
    }
    run();
    const interval = setInterval(run, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [workspace.id, workspace.links]);

  async function handleRefreshLinks() {
    const urls = (workspace.links ?? []).map((l) => l.url);
    const results = await Promise.all(
      urls.map((url) => window.api.links.refresh(url)),
    );
    const next: Record<string, LinkStatus> = {};
    urls.forEach((url, i) => (next[url] = results[i]));
    setLinkHydrations(next);
  }

  function handleAddTodo() {
    const text = todoInput.trim();
    if (!text) return;
    const todo: TodoItem = { id: Date.now().toString(36), text, done: false };
    onUpdate({ ...workspace, todos: [...todos, todo] });
    setTodoInput("");
  }

  function handleToggleTodo(id: string) {
    const updated = todos.map((t) =>
      t.id === id ? { ...t, done: !t.done } : t,
    );
    onUpdate({ ...workspace, todos: updated });
  }

  function handleDeleteTodo(id: string) {
    onUpdate({ ...workspace, todos: todos.filter((t) => t.id !== id) });
  }

  function handleAddNote() {
    const text = noteInput.trim();
    if (!text) return;
    const note: NoteItem = {
      id: Date.now().toString(36),
      text,
      createdAt: new Date().toISOString(),
    };
    onUpdate({ ...workspace, notes: [note, ...noteItems] });
    setNoteInput("");
  }

  function handleDeleteNote(id: string) {
    onUpdate({ ...workspace, notes: noteItems.filter((n) => n.id !== id) });
  }

  function handleSaveNoteEdit(id: string) {
    const text = editingNoteText.trim();
    if (!text) return;
    onUpdate({
      ...workspace,
      notes: noteItems.map((n) => (n.id === id ? { ...n, text } : n)),
    });
    setEditingNoteId(null);
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

    // Resolve repo: URL-qualified → workspace.repo → wing default.
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

    // Fetch status immediately — don't wait for the effect cycle
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
  const [availableSessions, setAvailableSessions] = useState<
    { name: string; status: string }[]
  >([]);
  const [showSessionPicker, setShowSessionPicker] = useState(false);

  useEffect(() => {
    window.api.agents.sessions().then(setAvailableSessions);
  }, [workspace.id]);

  const tmuxRunning = workspace.tmuxSession
    ? tmuxSessions.includes(workspace.tmuxSession)
    : false;

  return (
    <div className="detail-layout">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="detail-header">
        <div className="detail-header-main">
          <div
            className={`card-status-dot ${workspace.status}`}
            style={{ width: 10, height: 10 }}
          />
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
          <span className={`card-type-badge ${workspace.type}`}>
            {workspace.type}
          </span>
          <div className="gear-menu-wrapper">
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
          {workspace.branch && (
            <span className="detail-meta-item">
              <span className="detail-meta-label">branch</span>
              <code>{workspace.branch}</code>
            </span>
          )}
          {workspace.repo && (
            <span className="detail-meta-item">
              <span className="detail-meta-label">repo</span>
              <code>{workspace.repo}</code>
            </span>
          )}
          {workspace.directoryPath && (
            <span className="detail-meta-item">
              <span className="detail-meta-label">dir</span>
              <code>
                {workspace.directoryPath.replace(/^\/Users\/[^/]+/, "~")}
              </code>
            </span>
          )}
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────── */}
      <div className="detail-body detail-body-flipped">
        {/* Left panel: Todos + Notes */}
        <div className="detail-sidebar">
          <div className="detail-section" style={{ flex: 1 }}>
            <div className="detail-section-title">Todos</div>
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
                  <div key={todo.id} className="todo-item">
                    <input
                      type="checkbox"
                      className="todo-checkbox"
                      checked={false}
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

          {/* Notes */}
          <div className="detail-section">
            <div className="section-header">
              <span className="detail-section-title">Notes</span>
              <div className="section-header-right">
                <input
                  className="form-input form-input-sm"
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddNote()}
                  placeholder="Add a note…"
                />
              </div>
            </div>
            {noteItems.length > 0 && (
              <div className="note-list">
                {noteItems.map((note) => (
                  <div key={note.id} className="note-card">
                    {editingNoteId === note.id ? (
                      <input
                        className="form-input note-edit-input"
                        value={editingNoteText}
                        onChange={(e) => setEditingNoteText(e.target.value)}
                        onBlur={() => handleSaveNoteEdit(note.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveNoteEdit(note.id);
                          if (e.key === "Escape") setEditingNoteId(null);
                        }}
                        autoFocus
                      />
                    ) : (
                      <span
                        className="note-text"
                        onClick={() => {
                          setEditingNoteId(note.id);
                          setEditingNoteText(note.text);
                        }}
                      >
                        {note.text}
                      </span>
                    )}
                    <span className="note-time">
                      {new Date(note.createdAt).toLocaleDateString()}
                    </span>
                    <button
                      className="note-delete"
                      onClick={() => handleDeleteNote(note.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Main panel: Launch + Config + PRs */}
        <div className="detail-main">
          {/* Launch + Session */}
          <div className="detail-section">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <button className="btn btn-primary" onClick={handleLaunch}>
                Launch
              </button>
              {tmuxRunning && (
                <button
                  className="btn btn-ghost"
                  style={{ color: "var(--red)", borderColor: "var(--red)33" }}
                  onClick={handleStop}
                >
                  Stop
                </button>
              )}

              {/* Session link/picker */}
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
                          <span
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                            }}
                          >
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
          </div>

          {/* Config fields in a horizontal row */}
          <div className="detail-section">
            <div className="detail-section-title">Configuration</div>
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
                  if (Object.keys(update).length > 0) handleFieldUpdate(update);
                }}
              />
            </div>
          </div>

          {/* Pull Requests */}
          <div className="detail-section">
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
                <button className="btn btn-ghost btn-sm" onClick={handleAddPR}>
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
                      style={{ opacity: 0.5 }}
                    >
                      <PRCard
                        pr={{
                          number: p.number,
                          title: "Loading…",
                          state: "open",
                          url: "",
                          isDraft: false,
                          ciStatus: "unknown",
                          reviewDecision: null,
                          openComments: 0,
                          repo: p.repo,
                        }}
                      />
                      <button
                        className="detail-pr-remove-overlay"
                        style={{ opacity: 1 }}
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

          {/* Links — 3-column grid: docs / tickets / other */}
          <div className="detail-section">
            <div className="section-header">
              <span className="detail-section-title">Links</span>
              <div className="section-header-right flex items-center gap-2">
                {linkItems.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={handleRefreshLinks}
                    title="Refresh link metadata"
                  >
                    ↻
                  </button>
                )}
                <input
                  className="form-input form-input-sm"
                  value={linkInput}
                  onChange={(e) => setLinkInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddLink()}
                  placeholder="Paste a URL…"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                { category: "docs" as LinkCategory, label: "Docs", icon: "📄" },
                {
                  category: "tickets" as LinkCategory,
                  label: "Tickets",
                  icon: "🎫",
                },
                {
                  category: "other" as LinkCategory,
                  label: "Other",
                  icon: "🔗",
                },
              ].map(({ category, label, icon }) => {
                const items = linkItems.filter(
                  (l) =>
                    (l.category ?? (l as any).type ?? "other") === category,
                );
                return (
                  <div key={category} className="flex flex-col gap-1 min-w-0">
                    <div className="link-category-label">
                      {icon} {label}
                    </div>
                    {items.length > 0 ? (
                      <div className="link-list">
                        {items.map((link) => (
                          <LinkRow
                            key={link.id}
                            link={link}
                            hydration={linkHydrations[link.url]}
                            onDelete={() => handleDeleteLink(link.id)}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-fg-muted italic py-1">
                        None
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const STATUS_KIND_CLASSES: Record<LinkStatusKind, string> = {
  open: "bg-bg-input text-fg-muted border-line",
  "in-progress": "bg-bg-input text-blue border-blue",
  done: "bg-bg-input text-green border-green",
  blocked: "bg-bg-input text-red border-red",
  unknown: "bg-bg-input text-fg-muted border-line",
};

interface LinkRowProps {
  link: WorkspaceLink;
  hydration?: LinkStatus;
  onDelete: () => void;
}

function LinkRow({ link, hydration, onDelete }: LinkRowProps) {
  const title = hydration?.title ?? link.label;
  const isError = !!hydration?.error;
  const isAuthError =
    hydration?.error === "auth" || hydration?.error === "not-configured";
  const errorTooltip = (() => {
    switch (hydration?.error) {
      case "auth":
        return "Authentication failed — check your API key in Settings";
      case "not-configured":
        return "Connector not configured — add one in Settings";
      case "not-found":
        return "Not found";
      case "forbidden":
        return "Forbidden";
      case "rate-limited":
        return "Rate limited";
      case "network":
        return "Network error";
      case "unsupported":
        return undefined;
      default:
        return undefined;
    }
  })();

  return (
    <div
      className="link-row"
      onClick={() => window.api.shell.openExternal(link.url)}
      title={errorTooltip}
    >
      <span className="link-source-badge">{link.source}</span>
      <span className={`link-label ${isError ? "text-fg-muted italic" : ""}`}>
        {isAuthError && "🔒 "}
        {title}
      </span>
      {hydration?.statusKind && hydration?.status && (
        <span
          className={`text-xs px-[6px] py-[1px] rounded-sm border ${
            STATUS_KIND_CLASSES[hydration.statusKind]
          }`}
        >
          {hydration.status}
        </span>
      )}
      <span className="link-url">
        {link.url.replace(/^https?:\/\//, "").slice(0, 40)}
      </span>
      <button
        className="link-delete"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        ×
      </button>
    </div>
  );
}

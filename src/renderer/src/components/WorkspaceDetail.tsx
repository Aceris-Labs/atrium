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
import { LinkCard } from "./LinkCard";
import { ItemsTab } from "./ItemsTab";
import { CreateWorktreeModal } from "./CreateWorktreeModal";
import { Checkbox } from "./Checkbox";
import {
  LaunchProfileEditor,
  initialProfileState,
  buildProfile,
  type ProfileEditorState,
} from "./LaunchProfileEditor";
import {
  usePRsForWorkspace,
  usePRTags,
  useAgentStatus,
  useRecap,
  useTmuxSession,
} from "../store/selectors";
import { useCacheStore } from "../store/cache";
import { prKey, type PRTag } from "../../../shared/cacheTypes";
import type {
  PRStatus,
  Workspace,
  Wing,
  Item,
  WorkspaceLink,
  LinkCategory,
  LinkStatus,
  GitRepoInfo,
  DetectedTools,
} from "../../../shared/types";

type Tab = "overview" | "items" | "links" | "settings";

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
  onUpdate: (workspace: Workspace) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, toWingId: string) => void;
  onBack: () => void;
  onPRDragStart?: (pr: PRStatus) => void;
  onPRDragEnd?: () => void;
  onItemDragStart?: (item: Item) => void;
  onItemDragEnd?: () => void;
  onLinkDragStart?: (link: WorkspaceLink) => void;
  onLinkDragEnd?: () => void;
}

function linkStatusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("done") || s.includes("closed") || s.includes("complete"))
    return "bg-green/10 text-green border-green/40";
  if (s.includes("progress") || s.includes("review") || s.includes("started"))
    return "bg-blue/10 text-blue border-blue/40";
  if (s.includes("block") || s.includes("cancel"))
    return "bg-red/10 text-red border-red/40";
  if (s.includes("open") || s.includes("todo") || s.includes("backlog"))
    return "bg-yellow/10 text-yellow border-yellow/40";
  return "bg-bg-input text-fg-muted border-line";
}

function parsePRInput(input: string): { number: number; repo?: string } | null {
  const urlMatch = input.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (urlMatch) return { repo: urlMatch[1], number: parseInt(urlMatch[2], 10) };
  const num = parseInt(input, 10);
  if (!isNaN(num) && num > 0) return { number: num };
  return null;
}

/** Given a draggable container, find which child is nearest the cursor and
 *  whether to insert before or after it. Used to extend reorder drop coverage
 *  past individual cards into the gaps and the leading/trailing edges of the
 *  grid — otherwise a length-2 list has no way to express "drop at the end". */
function findNearestDropPoint(
  containerEl: HTMLElement,
  clientX: number,
  clientY: number,
  childIds: string[],
): { id: string; before: boolean; horizontal: boolean } | null {
  const children = Array.from(containerEl.children) as HTMLElement[];
  if (children.length === 0 || childIds.length !== children.length) return null;

  // Grid layout if any two children share roughly the same Y.
  let isGrid = false;
  const firstTop = children[0].getBoundingClientRect().top;
  for (let i = 1; i < children.length; i++) {
    if (Math.abs(children[i].getBoundingClientRect().top - firstTop) < 5) {
      isGrid = true;
      break;
    }
  }

  let nearestIdx = 0;
  let nearestDist = Infinity;
  for (let i = 0; i < children.length; i++) {
    const r = children[i].getBoundingClientRect();
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const d = dx * dx + dy * dy;
    if (d < nearestDist) {
      nearestDist = d;
      nearestIdx = i;
    }
  }

  const r = children[nearestIdx].getBoundingClientRect();
  const before = isGrid
    ? clientX < (r.left + r.right) / 2
    : clientY < (r.top + r.bottom) / 2;
  return { id: childIds[nearestIdx], before, horizontal: isGrid };
}

/** Pick the best card-display tag from the set of cache-side tags. The card
 *  shows at most one ribbon, so this is a priority cascade. */
function pickDisplayTag(
  tags: PRTag[],
): "review" | "watching" | "mine" | undefined {
  if (tags.includes("review")) return "review";
  if (tags.includes("watching")) return "watching";
  if (tags.includes("mine")) return "mine";
  return undefined;
}

/** Thin wrapper that pulls the per-wing tags for a PR out of the cache and
 *  passes the chosen display tag to PRCard. Keeps tag lookup co-located with
 *  the card so the parent doesn't have to thread tag membership through. */
function PRCardWithTag({
  pr,
  wingId,
  onClick,
}: {
  pr: PRStatus;
  wingId: string;
  onClick: () => void;
}) {
  const tags = usePRTags(wingId, pr.repo, pr.number);
  return <PRCard pr={pr} tag={pickDisplayTag(tags)} onClick={onClick} />;
}

export function WorkspaceDetail({
  wingId,
  workspace,
  allWings,
  onUpdate,
  onDelete,
  onMove,
  onBack,
  onPRDragStart,
  onPRDragEnd,
  onItemDragStart,
  onItemDragEnd,
  onLinkDragStart,
  onLinkDragEnd,
}: Props) {
  const items: Item[] = workspace.items ?? [];
  const linkItems: WorkspaceLink[] = workspace.links ?? [];
  const agentStatus = useAgentStatus(workspace.id);
  const linkHydrations = useCacheStore((s) => s.links);

  const [linkInput, setLinkInput] = useState("");
  const [prInput, setPrInput] = useState("");
  const [prInputError, setPrInputError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(workspace.title);
  const [refreshingLinks, setRefreshingLinks] = useState<Set<string>>(
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
  const [showMoveWing, setShowMoveWing] = useState(false);
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
  const [overrideLaunch, setOverrideLaunch] = useState(
    workspace.launchProfile !== undefined,
  );
  const [profileState, setProfileState] = useState<ProfileEditorState | null>(
    null,
  );
  const [tools, setTools] = useState<DetectedTools | null>(null);

  const titleInputRef = useRef<HTMLInputElement>(null);

  const openItems = items.filter((i) => !i.done);
  const ticketLinks = linkItems.filter((l) => l.category === "tickets");

  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "overview", label: "Overview" },
    { id: "items", label: "Items", count: openItems.length },
    { id: "links", label: "Links", count: linkItems.length },
    { id: "settings", label: "Settings" },
  ];

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.select();
  }, [editingTitle]);

  // Linked PRs are kept fresh by the main-side cache refreshers (see
  // src/main/cache/refreshers/prs.ts). On mount, opportunistically request a
  // refresh for any workspace.prs key that isn't yet in the cache so the user
  // doesn't wait the full TTL on a freshly-added PR.
  useEffect(() => {
    const known = useCacheStore.getState().prs;
    for (const p of workspace.prs) {
      if (!known[prKey(p.repo, p.number)]) {
        void window.api.cache.requestPRRefresh(p.repo, p.number);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id, workspace.prs]);

  useEffect(() => {
    window.api.agents.sessions().then(setAvailableSessions);
  }, [workspace.id]);

  useEffect(() => {
    setOverrideLaunch(workspace.launchProfile !== undefined);
    (async () => {
      const config = await window.api.config.get();
      const fromWing = wing?.launchProfile;
      setProfileState(
        initialProfileState(
          workspace.launchProfile ?? fromWing ?? config.defaultLaunchProfile,
        ),
      );
    })();
    window.api.setup.detect().then(setTools);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id]);

  const wing = allWings.find((w) => w.id === wingId);
  const effectiveDir = workspace.worktree?.path ?? wing?.projectDir;
  const recap = useRecap(workspace.id);

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
      const text = await window.api.workspace.generateDigest(workspace);
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
    setRefreshingLinks(new Set(urls));
    try {
      await Promise.all(
        urls.map((url) => window.api.cache.requestLinkRefresh(url)),
      );
    } finally {
      setRefreshingLinks(new Set());
    }
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
    void window.api.cache.requestPRRefresh(repo, parsed.number);
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
      // Tmux session list refreshes via the cache's tmux refresher; trigger
      // an immediate tick so the launched session shows up before the next
      // 30-second poll.
      void window.api.cache.refreshAll();
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
    void window.api.cache.refreshAll();
  }

  // Linked PRs sourced from the cache, in workspace.prs order so reordering
  // in the UI updates which one is "primary" on the workspace card.
  const linkedSlots = usePRsForWorkspace(workspace);
  const linkedPRs = linkedSlots
    .map((s) => s.pr)
    .filter((pr): pr is PRStatus => pr !== undefined);
  const tmuxRunning = useTmuxSession(workspace.tmuxSession);

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
                <span className={`status-dot status-${workspace.status}`} />
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
                  actualBranch || workspace.branch ? "text-fg" : "text-fg-muted"
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
                    <div className="max-h-[280px] overflow-y-auto">
                      {branchRepoInfo.branches.map((b) => (
                        <button
                          key={b}
                          className={`gear-menu-item${workspace.branch === b ? " selected" : ""}`}
                          onClick={() => commitBranchCheckout(b)}
                        >
                          {b}
                        </button>
                      ))}
                    </div>
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
            className="inline-flex items-center gap-1.5 px-[14px] py-[6px] bg-blue text-white text-sm font-semibold rounded-sm hover:brightness-90 cursor-pointer"
            onClick={() => handleLaunch()}
            title="Launch this space"
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
          <button
            className="flex items-center justify-center w-7 h-7 ml-1 rounded-sm text-fg-muted hover:text-fg hover:bg-bg-card-hover border border-line"
            onClick={onBack}
            title="Close space"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
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
                  <div
                    className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(300px,1fr))] auto-rows-fr"
                    onDragOver={(e) => {
                      if (!draggingPRKey) return;
                      e.preventDefault();
                      const ids = [
                        ...linkedPRs.map((p) => `${p.repo ?? ""}-${p.number}`),
                        ...workspace.prs
                          .filter(
                            (p) =>
                              !linkedPRs.find(
                                (k) =>
                                  k.repo === p.repo && k.number === p.number,
                              ),
                          )
                          .map((p) => `${p.repo}-${p.number}`),
                      ];
                      const point = findNearestDropPoint(
                        e.currentTarget,
                        e.clientX,
                        e.clientY,
                        ids,
                      );
                      if (point && point.id !== draggingPRKey) {
                        setPRDropTarget({
                          key: point.id,
                          before: point.before,
                        });
                      }
                    }}
                    onDrop={(e) => {
                      if (!draggingPRKey) return;
                      e.preventDefault();
                      if (prDropTarget && prDropTarget.key !== draggingPRKey) {
                        handleReorderPR(
                          draggingPRKey,
                          prDropTarget.key,
                          prDropTarget.before,
                        );
                      }
                      setDraggingPRKey(null);
                      setPRDropTarget(null);
                    }}
                  >
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
                          onDragStart={() => {
                            setDraggingPRKey(key);
                            onPRDragStart?.(pr);
                          }}
                          onDragEnd={() => {
                            setDraggingPRKey(null);
                            setPRDropTarget(null);
                            onPRDragEnd?.();
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
                          <PRCardWithTag
                            pr={pr}
                            wingId={wingId}
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
              {(items.length > 0 || ticketLinks.length > 0) && (
                <div className="rounded-md border border-line divide-y divide-line">
                  {items.length > 0 && (
                    <button
                      type="button"
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-card-hover text-left"
                      onClick={() => setActiveTab("items")}
                      title="Open Items tab"
                    >
                      <span className="text-xs text-fg-muted w-14 shrink-0">
                        Items
                      </span>
                      <div className="flex-1 h-1 bg-bg rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green rounded-full transition-all"
                          style={{
                            width: `${(items.filter((i) => i.done).length / items.length) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="text-xs text-fg-muted tabular-nums shrink-0">
                        {items.filter((i) => i.done).length}/{items.length} done
                      </span>
                    </button>
                  )}

                  {ticketLinks.length > 0 && (
                    <div className="flex flex-col gap-2 px-4 py-3">
                      <button
                        type="button"
                        className="text-xs text-fg-muted hover:text-fg text-left -mx-1 px-1 py-0.5 rounded-sm hover:bg-bg-card-hover self-start"
                        onClick={() => setActiveTab("links")}
                        title="Open Links tab"
                      >
                        Tickets
                      </button>
                      {ticketLinks.map((link) => {
                        const h = linkHydrations[link.url];
                        const isLoading = !h && refreshingLinks.has(link.url);
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
                                  <span
                                    className={`text-xs px-1.5 py-0.5 rounded-sm border shrink-0 ${linkStatusBadgeClass(h.status)}`}
                                  >
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
                    items, and links.
                  </p>
                )}
              </div>
            </div>
          )}

          {activeTab === "items" && (
            <div className="h-[calc(100vh-260px)] min-h-[400px]">
              <ItemsTab
                items={items}
                onChange={(next) => onUpdate({ ...workspace, items: next })}
                onItemDragStart={onItemDragStart}
                onItemDragEnd={onItemDragEnd}
              />
            </div>
          )}

          {activeTab === "links" && (
            <LinksTab
              links={linkItems}
              linkInput={linkInput}
              onLinkInputChange={setLinkInput}
              onAddLink={handleAddLink}
              onRefresh={handleRefreshLinks}
              hydrations={linkHydrations}
              refreshingLinks={refreshingLinks}
              onDelete={handleDeleteLink}
              onReorder={(orderedIds) => {
                const byId = new Map(linkItems.map((l) => [l.id, l]));
                const reordered = orderedIds
                  .map((id) => byId.get(id))
                  .filter((l): l is WorkspaceLink => !!l);
                onUpdate({ ...workspace, links: reordered });
              }}
              onLinkDragStart={onLinkDragStart}
              onLinkDragEnd={onLinkDragEnd}
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
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm self-start"
                    onClick={() => setShowMoveWing(true)}
                  >
                    Move to another wing…
                  </button>
                </div>
              )}

              {/* Launch overrides */}
              <div className="border border-line rounded-md p-4 flex flex-col gap-3">
                <label className="wt-checkbox-label">
                  <Checkbox
                    checked={overrideLaunch}
                    onChange={() => {
                      const next = !overrideLaunch;
                      setOverrideLaunch(next);
                      if (!next) {
                        onUpdate({ ...workspace, launchProfile: undefined });
                      } else if (profileState) {
                        onUpdate({
                          ...workspace,
                          launchProfile: buildProfile(profileState),
                        });
                      }
                    }}
                  />
                  Override launch profile for this space
                </label>
                <p className="text-xs text-fg-muted">
                  When off, this space inherits{" "}
                  {wing?.launchProfile ? "the wing's" : "the global"} launch
                  profile.
                </p>
                {overrideLaunch && profileState && (
                  <div className="flex flex-col gap-3">
                    <LaunchProfileEditor
                      state={profileState}
                      onChange={(next) => {
                        setProfileState(next);
                        onUpdate({
                          ...workspace,
                          launchProfile: buildProfile(next),
                        });
                      }}
                      tools={tools}
                    />
                  </div>
                )}
              </div>

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

      {showMoveWing && (
        <div className="modal-overlay" onClick={() => setShowMoveWing(false)}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 420 }}
          >
            <div className="modal-title">Move to another wing</div>
            <p className="setup-desc" style={{ marginBottom: 12 }}>
              Move <strong>{workspace.title}</strong> out of this wing.
            </p>
            <div className="flex flex-col gap-1 mb-4 max-h-[300px] overflow-y-auto">
              {allWings
                .filter((w) => w.id !== wingId)
                .map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    className="text-left px-3 py-2 rounded-sm border border-line hover:bg-bg-card-hover text-sm text-fg"
                    onClick={() => {
                      onMove(workspace.id, w.id);
                      setShowMoveWing(false);
                    }}
                  >
                    {w.name}
                  </button>
                ))}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowMoveWing(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
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
  refreshingLinks: Set<string>;
  onDelete: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
  onLinkDragStart?: (link: WorkspaceLink) => void;
  onLinkDragEnd?: () => void;
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
  refreshingLinks,
  onDelete,
  onReorder,
  onLinkDragStart,
  onLinkDragEnd,
}: LinksTabProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    before: boolean;
    horizontal: boolean;
  } | null>(null);

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

  function handleReorder(draggedId: string, targetId: string, before: boolean) {
    if (draggedId === targetId) return;
    const next = [...links];
    const fromIdx = next.findIndex((l) => l.id === draggedId);
    const toIdx = next.findIndex((l) => l.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = next.splice(fromIdx, 1);
    const adjusted = fromIdx < toIdx ? toIdx - 1 : toIdx;
    next.splice(before ? adjusted : adjusted + 1, 0, moved);
    onReorder(next.map((l) => l.id));
  }

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
            <div
              className="link-list"
              onDragOver={(e) => {
                if (!draggingId) return;
                e.preventDefault();
                const point = findNearestDropPoint(
                  e.currentTarget,
                  e.clientX,
                  e.clientY,
                  grouped[group].map((l) => l.id),
                );
                if (point && point.id !== draggingId) setDropTarget(point);
              }}
              onDrop={(e) => {
                if (!draggingId) return;
                e.preventDefault();
                if (dropTarget && dropTarget.id !== draggingId) {
                  handleReorder(draggingId, dropTarget.id, dropTarget.before);
                }
                setDraggingId(null);
                setDropTarget(null);
              }}
            >
              {grouped[group].map((link) => {
                const isDragging = draggingId === link.id;
                const showInsertBefore =
                  draggingId !== null &&
                  draggingId !== link.id &&
                  dropTarget?.id === link.id &&
                  dropTarget.before;
                const showInsertAfter =
                  draggingId !== null &&
                  draggingId !== link.id &&
                  dropTarget?.id === link.id &&
                  !dropTarget.before;
                const horizontal = !!dropTarget?.horizontal;
                return (
                  <div
                    key={link.id}
                    className="relative h-full"
                    draggable
                    onDragStart={() => {
                      setDraggingId(link.id);
                      onLinkDragStart?.(link);
                    }}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setDropTarget(null);
                      onLinkDragEnd?.();
                    }}
                    style={{ opacity: isDragging ? 0.4 : 1 }}
                  >
                    {showInsertBefore && horizontal && (
                      <div className="absolute -left-[5px] top-0 bottom-0 w-0.5 bg-blue rounded-full" />
                    )}
                    {showInsertAfter && horizontal && (
                      <div className="absolute -right-[5px] top-0 bottom-0 w-0.5 bg-blue rounded-full" />
                    )}
                    {showInsertBefore && !horizontal && (
                      <div className="absolute -top-[5px] left-0 right-0 h-0.5 bg-blue rounded-full" />
                    )}
                    {showInsertAfter && !horizontal && (
                      <div className="absolute -bottom-[5px] left-0 right-0 h-0.5 bg-blue rounded-full" />
                    )}
                    <LinkCard
                      link={link}
                      hydration={hydrations[link.url]}
                      isLoading={
                        !hydrations[link.url] && refreshingLinks.has(link.url)
                      }
                      onDelete={() => onDelete(link.id)}
                    />
                  </div>
                );
              })}
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
          <div className="gear-menu-backdrop" onClick={() => setOpen(false)} />
          <div
            className="absolute top-full left-0 mt-1 z-50 bg-bg-card border border-line rounded-md shadow-[0_4px_16px_rgba(0,0,0,0.3)] flex flex-col"
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
                          on <code className="text-fg-muted">{wt.branch}</code>
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

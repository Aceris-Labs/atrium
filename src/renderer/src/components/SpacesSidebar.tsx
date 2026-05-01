import { Fragment, useEffect, useRef, useState } from "react";
import {
  ChevronDownIcon,
  ArrowsPointingOutIcon,
  ArrowsPointingInIcon,
  PencilSquareIcon,
  XMarkIcon,
  EllipsisVerticalIcon,
} from "@heroicons/react/20/solid";
import { WorkspaceCard } from "./WorkspaceCard";
import { Checkbox } from "./Checkbox";
import type {
  PRStatus,
  Workspace,
  Wing,
  Item,
} from "../../../shared/types";

const STATUS_IDS = ["active", "blocked", "done", "archived"] as const;
type StatusId = (typeof STATUS_IDS)[number];
const STATUS_LABELS: Record<StatusId, string> = {
  active: "Active",
  blocked: "Blocked",
  done: "Done",
  archived: "Archived",
};

const ACTIVE_GROUP_ID = "active";

interface Props {
  wing: Wing | null;
  workspaces: Workspace[];
  prStatuses: PRStatus[];
  tmuxSessions: string[];
  agentStatuses: Record<
    string,
    "working" | "needs-input" | "idle" | "no-session"
  >;
  hiddenStatuses: Set<string>;
  expanded: boolean;
  onToggleExpanded: () => void;
  onToggleStatus: (status: StatusId) => void;
  onResetStatuses: (next: Set<string>) => void;

  onSelect: (workspaceId: string, e: React.MouseEvent) => void;
  onAddSpace: () => void;
  onUpdateWorkspace: (ws: Workspace) => Promise<void> | void;
  onUpdateWing: (wing: Wing) => Promise<void> | void;

  draggingPR: PRStatus | null;
  onDropPR: (workspace: Workspace, pr: PRStatus) => void;
  draggingItem: Item | null;
  onDropItem: (workspace: Workspace, note: Item) => void;

  selectedIds: Set<string>;
  onClearSelection: () => void;
  onBulkSetStatus: (status: Workspace["status"]) => void;
  onBulkSetGroup: (groupId: string | undefined) => void;
  onBulkDelete: () => void;
  onBulkUngroupSpaces: (ids: string[]) => Promise<void> | void;
  onReorderWorkspace: (
    draggedId: string,
    targetId: string,
    insertBefore: boolean,
  ) => Promise<void> | void;
}

export function SpacesSidebar({
  wing,
  workspaces,
  prStatuses,
  tmuxSessions,
  agentStatuses,
  hiddenStatuses,
  expanded,
  onToggleExpanded,
  onToggleStatus,
  onResetStatuses,
  onSelect,
  onAddSpace,
  onUpdateWorkspace,
  onUpdateWing,
  draggingPR,
  onDropPR,
  draggingItem,
  onDropItem,
  selectedIds,
  onClearSelection,
  onBulkSetStatus,
  onBulkSetGroup,
  onBulkDelete,
  onBulkUngroupSpaces,
  onReorderWorkspace,
}: Props) {
  const [showStatusFilter, setShowStatusFilter] = useState(false);
  const statusFilterRef = useRef<HTMLDivElement>(null);
  const [showNewGroupInput, setShowNewGroupInput] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set(),
  );
  const [draggingWorkspace, setDraggingWorkspace] = useState<Workspace | null>(
    null,
  );
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const draggingGroupIdRef = useRef<string | null>(null);
  const [groupDropTarget, setGroupDropTarget] = useState<string | null>(null);
  const [groupInsertBefore, setGroupInsertBefore] = useState<string | null>(
    null,
  );
  const groupInsertBeforeRef = useRef<string | null>(null);
  const [reorderTarget, setReorderTarget] = useState<{
    id: string;
    before: boolean;
  } | null>(null);

  const customGroupMap = new Map(
    (wing?.customGroups ?? []).map((g) => [g.id, g]),
  );
  // Build the rendered group order. We surface only the implicit "active"
  // default group plus user-created customs. Legacy status group IDs
  // (blocked/done/archived) that may exist in stored groupOrder are filtered
  // out — those statuses still affect the status filter, but no longer drive
  // sectioning.
  const rawOrder = wing?.groupOrder ?? [];
  const orderedCustoms = rawOrder.filter((id) => customGroupMap.has(id));
  const missingCustoms = (wing?.customGroups ?? [])
    .map((g) => g.id)
    .filter((id) => !orderedCustoms.includes(id));
  const hasActiveInOrder = rawOrder.includes(ACTIVE_GROUP_ID);
  const activeIdx = rawOrder.indexOf(ACTIVE_GROUP_ID);
  // If "active" was explicitly placed in stored order, respect its position
  // relative to customs; otherwise default it to the front.
  let groupIds: string[];
  if (hasActiveInOrder) {
    const before = rawOrder
      .slice(0, activeIdx)
      .filter((id) => customGroupMap.has(id));
    const after = rawOrder
      .slice(activeIdx + 1)
      .filter((id) => customGroupMap.has(id));
    groupIds = [...before, ACTIVE_GROUP_ID, ...after, ...missingCustoms];
  } else {
    groupIds = [ACTIVE_GROUP_ID, ...orderedCustoms, ...missingCustoms];
  }

  const validCustomIds = new Set(customGroupMap.keys());
  const ungroupedSpaces = workspaces.filter(
    (w) => !w.groupId || !validCustomIds.has(w.groupId),
  );

  type Section = {
    id: string;
    name: string;
    spaces: Workspace[];
    isActive: boolean;
  };

  const sections: Section[] = groupIds.map((gid) => {
    if (gid === ACTIVE_GROUP_ID) {
      return {
        id: gid,
        name: "Active",
        spaces: ungroupedSpaces.filter((w) => !hiddenStatuses.has(w.status)),
        isActive: true,
      };
    }
    const group = customGroupMap.get(gid)!;
    return {
      id: gid,
      name: group.name,
      spaces: workspaces.filter(
        (w) => w.groupId === gid && !hiddenStatuses.has(w.status),
      ),
      isActive: false,
    };
  });

  function toggleCollapsed(id: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleAddGroup() {
    const name = newGroupName.trim();
    if (!name || !wing) return;
    const id = crypto.randomUUID();
    const updatedCustomGroups = [...(wing.customGroups ?? []), { id, name }];
    const updatedGroupOrder = [...(wing.groupOrder ?? [ACTIVE_GROUP_ID]), id];
    await onUpdateWing({
      ...wing,
      customGroups: updatedCustomGroups,
      groupOrder: updatedGroupOrder,
    });
    setNewGroupName("");
    setShowNewGroupInput(false);
  }

  async function handleDeleteGroup(groupId: string) {
    if (!wing) return;
    const spacesInGroup = workspaces.filter((w) => w.groupId === groupId);
    if (spacesInGroup.length > 0) {
      await onBulkUngroupSpaces(spacesInGroup.map((w) => w.id));
    }
    await onUpdateWing({
      ...wing,
      customGroups: (wing.customGroups ?? []).filter((g) => g.id !== groupId),
      groupOrder: (wing.groupOrder ?? []).filter((id) => id !== groupId),
    });
  }

  async function handleRenameGroup(groupId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed || !wing) return;
    await onUpdateWing({
      ...wing,
      customGroups: (wing.customGroups ?? []).map((g) =>
        g.id === groupId ? { ...g, name: trimmed } : g,
      ),
    });
    setEditingGroupId(null);
    setEditingGroupName("");
  }

  async function handleReorderGroups(
    draggedId: string,
    insertBeforeId: string | null,
  ) {
    if (!wing) return;
    // Operate on the rendered order so reordering produces predictable results.
    const next = [...groupIds];
    const from = next.indexOf(draggedId);
    if (from === -1) return;
    next.splice(from, 1);
    if (!insertBeforeId || insertBeforeId === "__end__") {
      next.push(draggedId);
    } else {
      const to = next.indexOf(insertBeforeId);
      if (to === -1) next.push(draggedId);
      else next.splice(to, 0, draggedId);
    }
    await onUpdateWing({ ...wing, groupOrder: next });
  }

  async function handleDropWorkspaceOnGroup(ws: Workspace, groupId: string) {
    if (groupId === ACTIVE_GROUP_ID) {
      if (ws.groupId === undefined) return;
      await onUpdateWorkspace({ ...ws, groupId: undefined });
    } else {
      if (ws.groupId === groupId) return;
      await onUpdateWorkspace({ ...ws, groupId });
    }
  }

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

  return (
    <div
      className={`flex flex-col min-h-0 ${expanded ? "flex-1" : "w-[480px] shrink-0"} border-r border-line bg-bg`}
    >
      <div className="border-b border-line">
        <div className="flex items-center px-5 pt-3 pb-2">
          <span className="panel-title">Spaces</span>
          <button
            className="btn btn-ghost btn-sm ml-auto flex items-center gap-1"
            onClick={onToggleExpanded}
            title={expanded ? "Collapse sidebar" : "Expand sidebar to fill"}
          >
            {expanded ? (
              <ArrowsPointingInIcon className="w-4 h-4" />
            ) : (
              <ArrowsPointingOutIcon className="w-4 h-4" />
            )}
          </button>
        </div>
        <div className="flex items-center px-5 pb-3 gap-2">
          <div className="relative" ref={statusFilterRef}>
            <button
              className="btn btn-ghost btn-sm flex items-center gap-1"
              onClick={() => setShowStatusFilter((p) => !p)}
            >
              Status
              {hiddenStatuses.size > 0 && (
                <span className="text-fg-muted text-xs">
                  {STATUS_IDS.length - hiddenStatuses.size}/{STATUS_IDS.length}
                </span>
              )}
              <ChevronDownIcon className="w-3.5 h-3.5 text-fg-muted" />
            </button>
            {showStatusFilter && (
              <div className="absolute top-full left-0 mt-1 bg-bg-card border border-line rounded-md py-1 z-10 min-w-[160px] shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
                {STATUS_IDS.map((status) => (
                  <label
                    key={status}
                    className="group flex items-center gap-2 px-3 py-[6px] cursor-pointer hover:bg-bg-card-hover text-sm text-fg select-none"
                  >
                    <Checkbox
                      checked={!hiddenStatuses.has(status)}
                      onChange={() => onToggleStatus(status)}
                    />
                    <span className="flex-1">{STATUS_LABELS[status]}</span>
                    <button
                      type="button"
                      className="hidden group-hover:block text-xs text-fg-muted hover:text-fg px-1"
                      onClick={(e) => {
                        e.preventDefault();
                        onResetStatuses(
                          new Set(STATUS_IDS.filter((s) => s !== status)),
                        );
                      }}
                    >
                      only
                    </button>
                  </label>
                ))}
                <div className="border-t border-line mt-1 pt-1 px-3 py-[6px]">
                  <button
                    type="button"
                    className="text-xs text-fg-muted hover:text-fg"
                    onClick={() =>
                      onResetStatuses(
                        hiddenStatuses.size === 0
                          ? new Set(STATUS_IDS)
                          : new Set(),
                      )
                    }
                  >
                    {hiddenStatuses.size === 0 ? "Deselect all" : "Select all"}
                  </button>
                </div>
              </div>
            )}
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowNewGroupInput(true)}
          >
            + Group
          </button>
          <button
            className="btn btn-primary btn-sm ml-auto"
            onClick={onAddSpace}
          >
            + New
          </button>
        </div>
      </div>

      {showNewGroupInput && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-line bg-bg-card">
          <input
            className="form-input form-input-sm flex-1"
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
          <button className="btn btn-primary btn-sm" onClick={handleAddGroup}>
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
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-5">
        {sections.map((section, idx) => {
          const isCollapsed = collapsedGroups.has(section.id);
          const isGroupDropTarget = groupDropTarget === section.id;
          const canDropWorkspace =
            draggingWorkspace !== null &&
            (section.isActive
              ? draggingWorkspace.groupId !== undefined
              : draggingWorkspace.groupId !== section.id);
          const isDraggingGroup = draggingGroupId !== null;

          return (
            <Fragment key={section.id}>
              {groupInsertBefore === section.id && isDraggingGroup && (
                <div className="h-0.5 bg-blue rounded-full mx-1 mb-2" />
              )}
              <div
                className="mb-7 last:mb-0"
                onDragOver={(e) => {
                  const draggedGroupId = draggingGroupIdRef.current;
                  if (canDropWorkspace) {
                    e.preventDefault();
                    setGroupDropTarget(section.id);
                  } else if (draggedGroupId && draggedGroupId !== section.id) {
                    e.preventDefault();
                    const rect = e.currentTarget.getBoundingClientRect();
                    const inTopHalf = e.clientY < rect.top + rect.height / 2;
                    const insertBefore = inTopHalf
                      ? section.id
                      : (sections[idx + 1]?.id ?? "__end__");
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
                    handleDropWorkspaceOnGroup(draggingWorkspace, section.id);
                    setGroupDropTarget(null);
                  } else if (draggedGroupId && draggedGroupId !== section.id) {
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
                  className="flex items-center gap-2 mb-2 cursor-grab"
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
                  <button
                    className="text-fg-muted hover:text-fg w-6 h-6 flex items-center justify-center select-none rounded hover:bg-bg-card-hover"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCollapsed(section.id);
                    }}
                    title={isCollapsed ? "Expand group" : "Collapse group"}
                  >
                    <ChevronDownIcon
                      className="w-4 h-4"
                      style={{
                        transform: isCollapsed
                          ? "rotate(-90deg)"
                          : "rotate(0deg)",
                        transition: "transform 0.15s",
                      }}
                    />
                  </button>
                  <EllipsisVerticalIcon className="w-4 h-4 text-fg-muted select-none" />
                  {!section.isActive && editingGroupId === section.id ? (
                    <input
                      className="section-title bg-transparent border-b border-line-hover outline-none w-[140px]"
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
                  <span className="section-count">{section.spaces.length}</span>
                  {!section.isActive && (
                    <div className="ml-auto flex items-center gap-1">
                      <button
                        className="text-fg-muted hover:text-fg w-6 h-6 flex items-center justify-center rounded hover:bg-bg-card-hover"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingGroupId(section.id);
                          setEditingGroupName(section.name);
                        }}
                        title="Rename group"
                      >
                        <PencilSquareIcon className="w-4 h-4" />
                      </button>
                      <button
                        className="text-fg-muted hover:text-red w-6 h-6 flex items-center justify-center rounded hover:bg-bg-card-hover"
                        onClick={() => handleDeleteGroup(section.id)}
                        title="Remove group"
                      >
                        <XMarkIcon className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
                {!isCollapsed && (
                  <div
                    className={`${expanded ? "card-grid" : "flex flex-col gap-2"} rounded-md transition-colors${
                      isGroupDropTarget
                        ? " outline outline-2 outline-offset-2 outline-line-hover"
                        : ""
                    }`}
                  >
                    {section.spaces.map((ws) => {
                      const draggedSection = draggingWorkspace
                        ? (draggingWorkspace.groupId &&
                          validCustomIds.has(draggingWorkspace.groupId)
                            ? draggingWorkspace.groupId
                            : ACTIVE_GROUP_ID)
                        : null;
                      const sameSection =
                        draggingWorkspace !== null &&
                        draggedSection === section.id &&
                        draggingWorkspace.id !== ws.id;
                      const showLineBefore =
                        sameSection &&
                        reorderTarget?.id === ws.id &&
                        reorderTarget.before;
                      const showLineAfter =
                        sameSection &&
                        reorderTarget?.id === ws.id &&
                        !reorderTarget.before;
                      return (
                        <div
                          key={ws.id}
                          className="relative h-full"
                          onDragOver={(e) => {
                            if (!sameSection) return;
                            e.preventDefault();
                            e.stopPropagation();
                            const rect =
                              e.currentTarget.getBoundingClientRect();
                            const before = expanded
                              ? e.clientX < rect.left + rect.width / 2
                              : e.clientY < rect.top + rect.height / 2;
                            setReorderTarget({ id: ws.id, before });
                          }}
                          onDrop={(e) => {
                            if (!sameSection || !draggingWorkspace) return;
                            e.preventDefault();
                            e.stopPropagation();
                            onReorderWorkspace(
                              draggingWorkspace.id,
                              ws.id,
                              reorderTarget?.before ?? true,
                            );
                            setReorderTarget(null);
                          }}
                        >
                          <WorkspaceCard
                            workspace={ws}
                            prStatuses={prStatuses}
                            tmuxRunning={
                              ws.tmuxSession
                                ? tmuxSessions.includes(ws.tmuxSession)
                                : false
                            }
                            agentStatus={
                              agentStatuses[ws.id] ?? "no-session"
                            }
                            selected={selectedIds.has(ws.id)}
                            onClick={(e) => onSelect(ws.id, e)}
                            draggingPR={
                              draggingWorkspace ? null : draggingPR
                            }
                            onDrop={(pr) => onDropPR(ws, pr)}
                            draggingItem={
                              draggingWorkspace ? null : draggingItem
                            }
                            onDropItem={(note) => onDropItem(ws, note)}
                            onWorkspaceDragStart={() =>
                              setDraggingWorkspace(ws)
                            }
                            onWorkspaceDragEnd={() => {
                              setDraggingWorkspace(null);
                              setGroupDropTarget(null);
                              setReorderTarget(null);
                            }}
                          />
                          {showLineBefore && (
                            <div
                              className={
                                expanded
                                  ? "absolute -left-1.5 top-0 bottom-0 w-1 bg-blue rounded-full pointer-events-none"
                                  : "absolute -top-1 left-0 right-0 h-1 bg-blue rounded-full pointer-events-none"
                              }
                            />
                          )}
                          {showLineAfter && (
                            <div
                              className={
                                expanded
                                  ? "absolute -right-1.5 top-0 bottom-0 w-1 bg-blue rounded-full pointer-events-none"
                                  : "absolute -bottom-1 left-0 right-0 h-1 bg-blue rounded-full pointer-events-none"
                              }
                            />
                          )}
                        </div>
                      );
                    })}
                    {section.spaces.length === 0 && (
                      <div className="text-sm text-fg-muted italic py-2 px-1">
                        Drop spaces here
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Fragment>
          );
        })}
        {groupInsertBefore === "__end__" && draggingGroupId !== null && (
          <div className="h-0.5 bg-blue rounded-full mx-1" />
        )}
        {workspaces.length === 0 && (
          <div className="text-fg-muted text-sm italic">
            No spaces yet. Click + New to add one.
          </div>
        )}
      </div>
      {selectedIds.size > 0 ? (
        <BulkActionBar
          count={selectedIds.size}
          customGroups={wing?.customGroups ?? []}
          onClear={onClearSelection}
          onSetStatus={onBulkSetStatus}
          onSetGroup={onBulkSetGroup}
          onDelete={onBulkDelete}
        />
      ) : (
        <div className="border-t border-line px-5 py-2 flex items-center">
          <span className="ml-auto text-xs text-fg-muted">
            {workspaces.length} {workspaces.length === 1 ? "space" : "spaces"}
          </span>
        </div>
      )}
    </div>
  );
}

interface BulkActionBarProps {
  count: number;
  customGroups: { id: string; name: string }[];
  onClear: () => void;
  onSetStatus: (status: Workspace["status"]) => void;
  onSetGroup: (groupId: string | undefined) => void;
  onDelete: () => void;
}

function BulkActionBar({
  count,
  customGroups,
  onClear,
  onSetStatus,
  onSetGroup,
  onDelete,
}: BulkActionBarProps) {
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [showGroupMenu, setShowGroupMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (confirmDelete) {
    return (
      <div className="border-t border-line px-3 py-2 flex items-center gap-2 bg-bg-card">
        <span className="text-sm text-fg">
          Delete {count} space{count === 1 ? "" : "s"}?
        </span>
        <button
          className="btn btn-sm ml-auto"
          style={{
            background: "var(--red)",
            borderColor: "var(--red)",
            color: "#fff",
          }}
          onClick={() => {
            onDelete();
            setConfirmDelete(false);
          }}
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
    );
  }

  return (
    <div className="border-t border-line px-3 py-2 flex items-center gap-2 bg-bg-card">
      <span className="text-sm text-fg font-semibold">
        {count} selected
      </span>

      {/* Move to group */}
      <div className="relative ml-auto">
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setShowGroupMenu((p) => !p);
            setShowStatusMenu(false);
          }}
        >
          Group ▾
        </button>
        {showGroupMenu && (
          <>
            <div
              className="gear-menu-backdrop"
              onClick={() => setShowGroupMenu(false)}
            />
            <div
              className="gear-menu"
              style={{ minWidth: 180, bottom: "100%", top: "auto", marginBottom: 4 }}
            >
              <button
                className="gear-menu-item"
                onClick={() => {
                  onSetGroup(undefined);
                  setShowGroupMenu(false);
                }}
              >
                Active (default)
              </button>
              {customGroups.map((g) => (
                <button
                  key={g.id}
                  className="gear-menu-item"
                  onClick={() => {
                    onSetGroup(g.id);
                    setShowGroupMenu(false);
                  }}
                >
                  {g.name}
                </button>
              ))}
              {customGroups.length === 0 && (
                <div className="px-3 py-2 text-xs text-fg-muted italic">
                  No custom groups yet
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Set status */}
      <div className="relative">
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setShowStatusMenu((p) => !p);
            setShowGroupMenu(false);
          }}
        >
          Status ▾
        </button>
        {showStatusMenu && (
          <>
            <div
              className="gear-menu-backdrop"
              onClick={() => setShowStatusMenu(false)}
            />
            <div
              className="gear-menu"
              style={{ minWidth: 160, bottom: "100%", top: "auto", marginBottom: 4 }}
            >
              {(["active", "blocked", "done", "archived"] as const).map((s) => (
                <button
                  key={s}
                  className="gear-menu-item"
                  onClick={() => {
                    onSetStatus(s);
                    setShowStatusMenu(false);
                  }}
                >
                  <span className="flex items-center gap-2">
                    <span className={`status-dot status-${s}`} />
                    {s}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <button
        className="btn btn-ghost btn-sm"
        style={{ color: "var(--red)" }}
        onClick={() => setConfirmDelete(true)}
        title="Delete selected"
      >
        Delete
      </button>

      <button
        className="btn btn-ghost btn-sm"
        onClick={onClear}
        title="Clear selection"
      >
        ✕
      </button>
    </div>
  );
}

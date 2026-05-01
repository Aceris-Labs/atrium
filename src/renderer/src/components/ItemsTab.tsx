import { useEffect, useRef, useState } from "react";
import { marked } from "marked";
import {
  PlusIcon,
  TrashIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  Bars3Icon,
} from "@heroicons/react/20/solid";
import { Checkbox } from "./Checkbox";
import type { Item } from "../../../shared/types";

marked.setOptions({ gfm: true, breaks: true });

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

export interface ItemsTabProps {
  items: Item[];
  onChange: (items: Item[]) => void;
  emptyMessage?: string;
  /** Optional drag-start hook for cross-component DnD (e.g. drag a wing item
   *  onto a workspace card to attach it). */
  onItemDragStart?: (item: Item) => void;
  onItemDragEnd?: () => void;
}

export function ItemsTab({
  items,
  onChange,
  emptyMessage,
  onItemDragStart,
  onItemDragEnd,
}: ItemsTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(
    items.find((i) => !i.done)?.id ?? items[0]?.id ?? null,
  );
  const [showDone, setShowDone] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [insertBeforeId, setInsertBeforeId] = useState<string | null>(null);

  const selected = selectedId
    ? items.find((i) => i.id === selectedId) ?? null
    : null;

  const active = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);

  function handleAdd() {
    const now = new Date().toISOString();
    const item: Item = {
      id: crypto.randomUUID(),
      title: "",
      done: false,
      createdAt: now,
      updatedAt: now,
    };
    onChange([item, ...items]);
    setSelectedId(item.id);
  }

  function handleUpdate(id: string, patch: Partial<Item>) {
    onChange(
      items.map((i) =>
        i.id === id
          ? { ...i, ...patch, updatedAt: new Date().toISOString() }
          : i,
      ),
    );
  }

  function handleDelete(id: string) {
    onChange(items.filter((i) => i.id !== id));
    if (selectedId === id) {
      const next = active.find((i) => i.id !== id) ?? done.find((i) => i.id !== id);
      setSelectedId(next?.id ?? null);
    }
  }

  function handleReorder(draggedId: string, targetId: string, before: boolean) {
    if (draggedId === targetId) return;
    const next = [...items];
    const fromIdx = next.findIndex((i) => i.id === draggedId);
    const toIdx = next.findIndex((i) => i.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = next.splice(fromIdx, 1);
    const adjusted = fromIdx < toIdx ? toIdx - 1 : toIdx;
    next.splice(before ? adjusted : adjusted + 1, 0, moved);
    onChange(next);
  }

  return (
    <div className="flex h-full gap-5 min-h-0">
      {/* Left: list */}
      <div className="w-[340px] shrink-0 flex flex-col min-h-0">
        <div className="flex items-center mb-3">
          <button
            className="btn btn-primary btn-sm flex items-center gap-1"
            onClick={handleAdd}
          >
            <PlusIcon className="w-3.5 h-3.5" />
            New item
          </button>
          <span className="ml-auto text-xs text-fg-muted">
            {active.length} active{done.length ? ` · ${done.length} done` : ""}
          </span>
        </div>

        <div
          className="flex-1 overflow-y-auto flex flex-col gap-1"
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setInsertBeforeId(null);
            }
          }}
        >
          {active.length === 0 && done.length === 0 && (
            <div className="text-sm text-fg-muted italic py-3 px-2">
              {emptyMessage ?? "No items yet. Click + New item."}
            </div>
          )}

          {active.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              selected={selectedId === item.id}
              dragging={draggingId === item.id}
              insertLineBefore={insertBeforeId === item.id}
              onClick={() => setSelectedId(item.id)}
              onToggleDone={() =>
                handleUpdate(item.id, { done: !item.done })
              }
              onDragStart={() => {
                setDraggingId(item.id);
                onItemDragStart?.(item);
              }}
              onDragEnd={() => {
                setDraggingId(null);
                setInsertBeforeId(null);
                onItemDragEnd?.();
              }}
              onDragOver={(e) => {
                if (!draggingId || draggingId === item.id) return;
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                const before = e.clientY < rect.top + rect.height / 2;
                setInsertBeforeId(before ? item.id : null);
                if (!before) {
                  // mark "after" by setting next item's before-position
                  const idx = active.findIndex((i) => i.id === item.id);
                  const nextItem = active[idx + 1];
                  setInsertBeforeId(nextItem?.id ?? "__active_end__");
                }
              }}
              onDrop={(e) => {
                if (!draggingId) return;
                e.preventDefault();
                const target = insertBeforeId ?? item.id;
                if (target === "__active_end__") {
                  // append to end of active group
                  const lastActive = active[active.length - 1];
                  if (lastActive)
                    handleReorder(draggingId, lastActive.id, false);
                } else {
                  handleReorder(draggingId, target, true);
                }
                setDraggingId(null);
                setInsertBeforeId(null);
              }}
            />
          ))}

          {done.length > 0 && (
            <button
              className="flex items-center gap-2 mt-3 px-2 py-1 text-xs text-fg-muted hover:text-fg cursor-pointer"
              onClick={() => setShowDone((v) => !v)}
            >
              {showDone ? (
                <ChevronDownIcon className="w-3 h-3" />
              ) : (
                <ChevronRightIcon className="w-3 h-3" />
              )}
              Done ({done.length})
            </button>
          )}

          {showDone &&
            done.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                selected={selectedId === item.id}
                dragging={false}
                insertLineBefore={false}
                onClick={() => setSelectedId(item.id)}
                onToggleDone={() =>
                  handleUpdate(item.id, { done: !item.done })
                }
              />
            ))}
        </div>
      </div>

      {/* Right: detail panel */}
      <div className="flex-1 min-w-0 min-h-0">
        {selected ? (
          <ItemDetailPanel
            key={selected.id}
            item={selected}
            onUpdate={(patch) => handleUpdate(selected.id, patch)}
            onDelete={() => handleDelete(selected.id)}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-fg-muted text-sm italic">
            Select an item, or click + New item to add one.
          </div>
        )}
      </div>
    </div>
  );
}

interface ItemRowProps {
  item: Item;
  selected: boolean;
  dragging: boolean;
  insertLineBefore: boolean;
  onClick: () => void;
  onToggleDone: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}

function ItemRow({
  item,
  selected,
  dragging,
  insertLineBefore,
  onClick,
  onToggleDone,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: ItemRowProps) {
  const draggable = !!onDragStart;
  return (
    <>
      {insertLineBefore && (
        <div className="h-0.5 bg-blue rounded-full mx-1" />
      )}
      <div
        draggable={draggable}
        onDragStart={(e) => {
          e.stopPropagation();
          onDragStart?.();
        }}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onClick={onClick}
        className={`group flex items-start gap-2 px-2 py-2 rounded-md cursor-pointer transition-colors ${
          selected
            ? "bg-bg-card-hover border border-blue"
            : "border border-transparent hover:bg-bg-card-hover"
        } ${dragging ? "opacity-40" : ""}`}
      >
        {draggable && (
          <Bars3Icon className="w-3.5 h-3.5 text-fg-muted opacity-0 group-hover:opacity-60 mt-0.5 shrink-0 cursor-grab" />
        )}
        <div onClick={(e) => e.stopPropagation()} className="mt-0.5">
          <Checkbox checked={item.done} onChange={onToggleDone} />
        </div>
        <div className="flex-1 min-w-0">
          <div
            className={`text-sm truncate ${item.done ? "line-through text-fg-muted" : "text-fg"}`}
          >
            {item.title || (
              <span className="italic text-fg-muted">(untitled)</span>
            )}
          </div>
        </div>
        {item.body && (
          <span
            className="text-fg-muted text-xs shrink-0 mt-0.5"
            title="Has notes"
          >
            ¶
          </span>
        )}
      </div>
    </>
  );
}

interface ItemDetailPanelProps {
  item: Item;
  onUpdate: (patch: Partial<Item>) => void;
  onDelete: () => void;
}

function ItemDetailPanel({ item, onUpdate, onDelete }: ItemDetailPanelProps) {
  const [titleDraft, setTitleDraft] = useState(item.title);
  const [bodyDraft, setBodyDraft] = useState(item.body ?? "");
  const [editingBody, setEditingBody] = useState(!item.body);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Reset drafts when the selected item changes
  useEffect(() => {
    setTitleDraft(item.title);
    setBodyDraft(item.body ?? "");
    setEditingBody(!item.body);
    setConfirmDelete(false);
  }, [item.id]);

  function commitTitle() {
    const t = titleDraft.trim();
    if (t !== item.title) onUpdate({ title: t });
  }

  function commitBody() {
    const b = bodyDraft.trim();
    const next = b || undefined;
    if (next !== item.body) onUpdate({ body: next });
    setEditingBody(false);
  }

  return (
    <div className="h-full flex flex-col bg-bg-card border border-line rounded-md overflow-hidden">
      {/* Header: checkbox + title + delete */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-line">
        <Checkbox
          checked={item.done}
          onChange={() => onUpdate({ done: !item.done })}
        />
        <input
          className={`flex-1 bg-transparent border-none outline-none text-base font-semibold ${item.done ? "line-through text-fg-muted" : "text-fg"}`}
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
              if (!editingBody) {
                setEditingBody(true);
                setTimeout(() => bodyRef.current?.focus(), 0);
              }
            }
          }}
          placeholder="Item title"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={!item.title}
        />
        {confirmDelete ? (
          <div className="flex items-center gap-1">
            <button
              className="btn btn-sm"
              style={{
                background: "var(--red)",
                borderColor: "var(--red)",
                color: "#fff",
              }}
              onClick={onDelete}
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
        ) : (
          <button
            className="text-fg-muted hover:text-red w-7 h-7 flex items-center justify-center rounded hover:bg-bg-card-hover"
            onClick={() => setConfirmDelete(true)}
            title="Delete item"
          >
            <TrashIcon className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Body: markdown preview / edit */}
      <div className="flex-1 overflow-y-auto p-5">
        {editingBody ? (
          <textarea
            ref={bodyRef}
            className="w-full h-full min-h-[200px] bg-bg-input border border-line rounded-sm text-sm text-fg placeholder:text-fg-muted resize-none p-3 leading-relaxed outline-none focus:border-line-hover"
            value={bodyDraft}
            onChange={(e) => setBodyDraft(e.target.value)}
            onBlur={commitBody}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                commitBody();
              }
              if (e.key === "Escape") {
                setBodyDraft(item.body ?? "");
                setEditingBody(false);
              }
            }}
            placeholder="Add notes for this item… (markdown supported, ⌘↩ to save)"
          />
        ) : item.body ? (
          <div
            className="prose-note text-sm text-fg leading-relaxed cursor-text"
            onClick={() => {
              setEditingBody(true);
              setTimeout(() => bodyRef.current?.focus(), 0);
            }}
            dangerouslySetInnerHTML={{
              __html: marked.parse(item.body) as string,
            }}
          />
        ) : (
          <button
            className="text-sm text-fg-muted italic hover:text-fg"
            onClick={() => {
              setEditingBody(true);
              setTimeout(() => bodyRef.current?.focus(), 0);
            }}
          >
            + Add notes…
          </button>
        )}
      </div>

      {/* Footer: timestamps */}
      <div className="border-t border-line px-5 py-2 text-xs text-fg-muted flex items-center gap-3">
        <span>Created {formatRelative(item.createdAt)}</span>
        {item.updatedAt !== item.createdAt && (
          <span>· Updated {formatRelative(item.updatedAt)}</span>
        )}
      </div>
    </div>
  );
}

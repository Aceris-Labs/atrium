import { useState } from "react";
import { marked } from "marked";
import type { NoteItem } from "../../../shared/types";

marked.setOptions({ gfm: true, breaks: true });

interface Props {
  notes: NoteItem[];
  onChange: (notes: NoteItem[]) => void;
  /** Fired when a note drag begins. Lets parent enable cross-component drop targets. */
  onNoteDragStart?: (note: NoteItem) => void;
  /** Fired when a note drag ends (drop or cancel). */
  onNoteDragEnd?: () => void;
  emptyMessage?: string;
  placeholder?: string;
}

function formatNoteTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const label = d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  if (diff < 60_000) return `${label} · just now`;
  if (diff < 3_600_000) return `${label} · ${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)
    return `${label} · ${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000)
    return `${label} · ${Math.floor(diff / 86_400_000)}d ago`;
  return label;
}

export function NotesSection({
  notes,
  onChange,
  onNoteDragStart,
  onNoteDragEnd,
  emptyMessage,
  placeholder,
}: Props) {
  const [input, setInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [insertBeforeIdx, setInsertBeforeIdx] = useState<number | null>(null);

  function handleAdd() {
    const text = input.trim();
    if (!text) return;
    const note: NoteItem = {
      id: crypto.randomUUID(),
      text,
      createdAt: new Date().toISOString(),
    };
    onChange([note, ...notes]);
    setInput("");
  }

  function handleDelete(id: string) {
    onChange(notes.filter((n) => n.id !== id));
  }

  function startEdit(note: NoteItem) {
    setEditingId(note.id);
    setEditingText(note.text);
  }

  function saveEdit(id: string) {
    const text = editingText.trim();
    if (!text) return;
    onChange(notes.map((n) => (n.id === id ? { ...n, text } : n)));
    setEditingId(null);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setInsertBeforeIdx(e.clientY < rect.top + rect.height / 2 ? idx : idx + 1);
  }

  function handleDrop() {
    if (draggingId === null || insertBeforeIdx === null) return;
    const fromIdx = notes.findIndex((n) => n.id === draggingId);
    if (fromIdx === -1) {
      setDraggingId(null);
      setInsertBeforeIdx(null);
      return;
    }
    const next = [...notes];
    const [moved] = next.splice(fromIdx, 1);
    const target =
      insertBeforeIdx > fromIdx ? insertBeforeIdx - 1 : insertBeforeIdx;
    next.splice(target, 0, moved);
    onChange(next);
    setDraggingId(null);
    setInsertBeforeIdx(null);
  }

  function handleDragEnd() {
    setDraggingId(null);
    setInsertBeforeIdx(null);
    onNoteDragEnd?.();
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Add note */}
      <div className="flex flex-col gap-2">
        <textarea
          className="w-full bg-bg-input border border-line rounded-sm text-base text-fg placeholder:text-fg-muted resize-none p-2 focus:outline-none focus:border-line-hover"
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder={placeholder ?? "Add a note… (⌘↩ to save)"}
        />
        <div className="flex justify-end">
          <button
            className="btn btn-primary text-sm"
            onClick={handleAdd}
            disabled={!input.trim()}
          >
            Add
          </button>
        </div>
      </div>

      {/* Note list */}
      {notes.length === 0 ? (
        <p className="detail-empty-text">
          {emptyMessage ?? "No notes yet. Add one above."}
        </p>
      ) : (
        <div
          className="flex flex-col gap-2"
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setInsertBeforeIdx(null);
            }
          }}
        >
          {notes.map((note, idx) => {
            const isDragging = draggingId === note.id;
            const isEditing = editingId === note.id;
            const showLine =
              draggingId !== null &&
              draggingId !== note.id &&
              insertBeforeIdx === idx;

            return (
              <div key={note.id} className="flex flex-col">
                {showLine && (
                  <div className="h-0.5 bg-blue rounded-full mb-2" />
                )}

                <div
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDrop();
                  }}
                  className={[
                    "group relative flex gap-2 bg-bg-input border border-line rounded-sm p-3 transition-colors",
                    isEditing ? "h-[200px]" : "h-[130px]",
                    isDragging ? "opacity-40" : "hover:border-line-hover",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {/* Delete button — top-right */}
                  {!isEditing && (
                    <button
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-transparent border-none text-fg-muted hover:text-red cursor-pointer text-base leading-none px-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(note.id);
                      }}
                      title="Delete"
                    >
                      ×
                    </button>
                  )}

                  {/* Drag handle — only this element is draggable */}
                  {!isEditing && (
                    <div
                      draggable
                      onDragStart={(e) => {
                        e.stopPropagation();
                        const card = (e.currentTarget as HTMLElement)
                          .parentElement;
                        if (card) {
                          const rect = card.getBoundingClientRect();
                          e.dataTransfer.setDragImage(
                            card,
                            e.clientX - rect.left,
                            e.clientY - rect.top,
                          );
                        }
                        setDraggingId(note.id);
                        onNoteDragStart?.(note);
                      }}
                      onDragEnd={handleDragEnd}
                      className="flex items-start pt-[2px] shrink-0 opacity-0 group-hover:opacity-40 cursor-grab text-fg-muted select-none text-base leading-none"
                    >
                      ⠿
                    </div>
                  )}

                  {/* Content */}
                  <div className="flex-1 min-w-0 min-h-0 flex flex-col">
                    {isEditing ? (
                      <div className="flex flex-col gap-2 flex-1 min-h-0">
                        <textarea
                          className="flex-1 min-h-0 w-full bg-bg border border-line rounded-sm text-base text-fg resize-none p-2 focus:outline-none focus:border-blue"
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                              e.preventDefault();
                              saveEdit(note.id);
                            }
                            if (e.key === "Escape") cancelEdit();
                          }}
                          autoFocus
                        />
                        <div className="flex items-center gap-2 justify-end shrink-0">
                          <span className="text-xs text-fg-muted mr-1">
                            ⌘↩ to save · esc to cancel
                          </span>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={cancelEdit}
                          >
                            Cancel
                          </button>
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => saveEdit(note.id)}
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div
                          className="prose-note text-base text-fg leading-relaxed cursor-text flex-1 overflow-y-auto min-h-0"
                          onClick={() => startEdit(note)}
                          dangerouslySetInnerHTML={{
                            __html: marked.parse(note.text) as string,
                          }}
                        />
                        <span className="text-fg-muted text-xs shrink-0 pt-2">
                          {formatNoteTime(note.createdAt)}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Insertion line after last card */}
          {draggingId !== null && insertBeforeIdx === notes.length && (
            <div className="h-0.5 bg-blue rounded-full" />
          )}
        </div>
      )}
    </div>
  );
}

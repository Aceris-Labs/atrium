import { useRef, useState } from "react";
import { marked } from "marked";
import type { NoteItem } from "../../../shared/types";

marked.setOptions({ gfm: true, breaks: true });

interface Props {
  notes: NoteItem[];
  onChange: (notes: NoteItem[]) => void;
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

export function NotesSection({ notes, onChange }: Props) {
  const [input, setInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);

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
    setTimeout(() => {
      editRef.current?.select();
    }, 0);
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

  // Drag-to-reorder
  function handleDragStart(id: string) {
    setDraggingId(id);
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    setOverIndex(idx);
  }

  function handleDrop(targetIdx: number) {
    if (draggingId === null) return;
    const fromIdx = notes.findIndex((n) => n.id === draggingId);
    if (fromIdx === -1 || fromIdx === targetIdx) {
      setDraggingId(null);
      setOverIndex(null);
      return;
    }
    const next = [...notes];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(targetIdx, 0, moved);
    onChange(next);
    setDraggingId(null);
    setOverIndex(null);
  }

  function handleDragEnd() {
    setDraggingId(null);
    setOverIndex(null);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Add note */}
      <div className="flex flex-col gap-2">
        <textarea
          ref={textareaRef}
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
          placeholder="Add a note… (⌘↩ to save)"
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
        <p className="detail-empty-text">No notes yet. Add one above.</p>
      ) : (
        <div
          className="grid gap-[10px]"
          style={{
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          }}
        >
          {notes.map((note, idx) => {
            const isDragging = draggingId === note.id;
            const isOver =
              overIndex === idx &&
              draggingId !== null &&
              draggingId !== note.id;

            return (
              <div
                key={note.id}
                draggable
                onDragStart={() => handleDragStart(note.id)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDrop={() => handleDrop(idx)}
                onDragEnd={handleDragEnd}
                className={[
                  "group relative flex gap-2 bg-bg-input border rounded-sm p-3 transition-colors",
                  editingId === note.id ? "min-h-[200px]" : "h-[200px]",
                  isDragging ? "opacity-40" : "",
                  isOver
                    ? "border-blue"
                    : "border-line hover:border-line-hover",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {/* Delete button — top-right corner */}
                {editingId !== note.id && (
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

                {/* Drag handle */}
                {editingId !== note.id && (
                  <div className="flex items-start pt-[2px] shrink-0 opacity-0 group-hover:opacity-40 cursor-grab text-fg-muted select-none text-base leading-none">
                    ⠿
                  </div>
                )}

                {/* Content */}
                <div className="flex-1 min-w-0 min-h-0 flex flex-col">
                  {editingId === note.id ? (
                    <div className="flex flex-col gap-2 flex-1">
                      <textarea
                        ref={editRef}
                        className="w-full bg-bg border border-line rounded-sm text-base text-fg resize-none p-2 focus:outline-none focus:border-blue"
                        style={{ minHeight: 100 }}
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
                    <div
                      className="prose-note text-base text-fg leading-relaxed cursor-text flex-1 overflow-y-auto min-h-0"
                      onClick={() => startEdit(note)}
                      dangerouslySetInnerHTML={{
                        __html: marked.parse(note.text) as string,
                      }}
                    />
                  )}

                  {/* Timestamp — always at bottom */}
                  <span className="text-fg-muted text-xs shrink-0 pt-2">
                    {formatNoteTime(note.createdAt)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

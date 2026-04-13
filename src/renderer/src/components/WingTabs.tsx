import { useEffect, useRef, useState } from 'react'
import type { Wing } from '../../../shared/types'

interface Props {
  wings: Wing[]
  activeId: string | null
  onSelect: (id: string) => void
  onReorder: (orderedIds: string[]) => void
  onRename: (id: string, newName: string) => void | Promise<void>
  onCreate: () => void
}

export function WingTabs({ wings, activeId, onSelect, onReorder, onRename, onCreate }: Props) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingId) editInputRef.current?.select()
  }, [editingId])

  function startEditing(wing: Wing) {
    setEditingId(wing.id)
    setEditDraft(wing.name)
  }

  function commitEdit() {
    if (!editingId) return
    const id = editingId
    const draft = editDraft
    setEditingId(null)
    setEditDraft('')
    void onRename(id, draft)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditDraft('')
  }

  function handleDragStart(e: React.DragEvent, id: string) {
    setDraggingId(id)
    e.dataTransfer.effectAllowed = 'move'
    // Needed so Firefox fires the drag events
    e.dataTransfer.setData('text/plain', id)
  }

  function handleDragOver(e: React.DragEvent, id: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (id !== dragOverId) setDragOverId(id)
  }

  function handleDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault()
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null)
      setDragOverId(null)
      return
    }
    const order = wings.map((w) => w.id)
    const fromIdx = order.indexOf(draggingId)
    const toIdx = order.indexOf(targetId)
    if (fromIdx === -1 || toIdx === -1) return
    order.splice(fromIdx, 1)
    order.splice(toIdx, 0, draggingId)
    onReorder(order)
    setDraggingId(null)
    setDragOverId(null)
  }

  function handleDragEnd() {
    setDraggingId(null)
    setDragOverId(null)
  }

  // VS Code-style tabs: flush rectangles, border-l as separator, top accent on active.
  const tabBase =
    'inline-flex items-center h-full px-6 text-base max-w-[220px] whitespace-nowrap overflow-hidden text-ellipsis cursor-pointer border-t-2 border-t-transparent border-l border-l-line first:border-l-0 transition-colors duration-100'

  return (
    <div className="flex items-stretch self-stretch [-webkit-app-region:no-drag]">
      {wings.map((wing) => {
        const isActive = wing.id === activeId
        const isDragging = wing.id === draggingId
        const isDragOver = wing.id === dragOverId && !isDragging
        const isEditing = wing.id === editingId
        if (isEditing) {
          return (
            <input
              key={wing.id}
              ref={editInputRef}
              className={`${tabBase} w-[160px] bg-bg-card text-fg font-semibold !border-t-blue outline-none`}
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitEdit()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  cancelEdit()
                }
              }}
            />
          )
        }
        const stateClasses = isActive
          ? 'bg-bg-card text-fg font-semibold !border-t-blue'
          : 'bg-transparent text-fg-muted font-medium hover:bg-bg-card hover:text-fg'
        const dragClasses = isDragging
          ? 'opacity-50'
          : isDragOver
            ? '!border-t-line-hover'
            : ''
        return (
          <button
            key={wing.id}
            type="button"
            className={`${tabBase} ${stateClasses} ${dragClasses}`}
            draggable
            onClick={() => onSelect(wing.id)}
            onDoubleClick={() => startEditing(wing)}
            onDragStart={(e) => handleDragStart(e, wing.id)}
            onDragOver={(e) => handleDragOver(e, wing.id)}
            onDrop={(e) => handleDrop(e, wing.id)}
            onDragEnd={handleDragEnd}
          >
            {wing.name}
          </button>
        )
      })}
      <button
        type="button"
        className="inline-flex items-center justify-center w-10 h-full border-l border-line text-fg-muted text-lg leading-none cursor-pointer bg-transparent hover:bg-bg-card hover:text-fg transition-colors duration-100"
        onClick={onCreate}
        title="New wing"
      >
        +
      </button>
    </div>
  )
}

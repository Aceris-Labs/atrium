import { useEffect, useRef, useState } from 'react'
import type { DirMatch } from '../../../shared/types'

interface Props {
  value: string
  onChange: (value: string) => void
  onSubmit?: () => void
  placeholder?: string
  autoFocus?: boolean
  className?: string
}

function longestCommonPrefix(strs: string[]): string {
  if (strs.length === 0) return ''
  let prefix = strs[0]
  for (let i = 1; i < strs.length; i++) {
    while (strs[i].toLowerCase().indexOf(prefix.toLowerCase()) !== 0) {
      prefix = prefix.slice(0, -1)
      if (prefix === '') return ''
    }
  }
  return prefix
}

function splitPath(input: string): { parent: string; prefix: string } {
  const lastSlash = input.lastIndexOf('/')
  if (lastSlash < 0) return { parent: '', prefix: input }
  return { parent: input.slice(0, lastSlash + 1), prefix: input.slice(lastSlash + 1) }
}

export function PathInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  autoFocus,
  className
}: Props) {
  const [matches, setMatches] = useState<DirMatch[]>([])
  const [highlightIdx, setHighlightIdx] = useState(-1)
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const skipNextFetchRef = useRef(false)

  // Debounced fetch whenever `value` changes (while focused).
  useEffect(() => {
    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false
      return
    }
    if (!open) return
    if (!value) {
      setMatches([])
      setHighlightIdx(-1)
      return
    }
    let cancelled = false
    const t = setTimeout(async () => {
      const result = await window.api.fs.listDirs(value)
      if (cancelled) return
      setMatches(result)
      setHighlightIdx(-1)
    }, 80)
    return () => { cancelled = true; clearTimeout(t) }
  }, [value, open])

  function applyCompletion(fullPath: string) {
    // Preserve the user's home-shortcut typing: if they started with `~/`,
    // keep it short-handed; otherwise use the absolute path.
    const { parent, prefix } = splitPath(value)
    const name = fullPath.split('/').pop() ?? ''
    const completed = parent + name
    skipNextFetchRef.current = true
    onChange(completed)
    // Leave the slash off so the user can see the full name; they can hit
    // Tab again after adding a `/` to descend.
    void prefix
  }

  function handleTab() {
    if (matches.length === 0) return
    if (matches.length === 1) {
      applyCompletion(matches[0].fullPath)
      // After selecting a single match, append `/` so next Tab descends.
      setTimeout(() => {
        const current = inputRef.current?.value ?? ''
        if (!current.endsWith('/')) onChange(current + '/')
      }, 0)
      return
    }
    // Multiple matches: complete to the longest common name prefix.
    const { parent } = splitPath(value)
    const names = matches.map((m) => m.name)
    const lcp = longestCommonPrefix(names)
    const currentPrefix = splitPath(value).prefix
    if (lcp.length > currentPrefix.length) {
      skipNextFetchRef.current = true
      onChange(parent + lcp)
    }
    // Either way, keep the dropdown visible so the user can see their options.
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault()
      handleTab()
      return
    }
    if (e.key === 'ArrowDown') {
      if (matches.length === 0) return
      e.preventDefault()
      setHighlightIdx((idx) => (idx + 1) % matches.length)
      return
    }
    if (e.key === 'ArrowUp') {
      if (matches.length === 0) return
      e.preventDefault()
      setHighlightIdx((idx) => (idx <= 0 ? matches.length - 1 : idx - 1))
      return
    }
    if (e.key === 'Enter') {
      if (highlightIdx >= 0 && matches[highlightIdx]) {
        e.preventDefault()
        applyCompletion(matches[highlightIdx].fullPath)
        return
      }
      if (onSubmit) {
        e.preventDefault()
        onSubmit()
      }
      return
    }
    if (e.key === 'Escape') {
      if (matches.length > 0) {
        e.preventDefault()
        setMatches([])
        setHighlightIdx(-1)
      }
      return
    }
  }

  return (
    <div className="relative w-full">
      <input
        ref={inputRef}
        className={`form-input ${className ?? ''}`}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Delay so clicks on dropdown items can still register.
          setTimeout(() => setOpen(false), 120)
        }}
        onKeyDown={handleKeyDown}
      />
      {open && matches.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 max-h-[220px] overflow-y-auto bg-bg-card border border-line rounded-sm z-20 shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
          {matches.map((m, i) => {
            const highlighted = i === highlightIdx
            return (
              <button
                key={m.fullPath}
                type="button"
                className={`block w-full text-left px-3 py-[6px] text-sm cursor-pointer border-none font-['SF_Mono','Fira_Code',monospace] ${highlighted ? 'bg-bg-card-hover text-fg' : 'bg-transparent text-fg hover:bg-bg-card-hover'}`}
                onMouseEnter={() => setHighlightIdx(i)}
                onMouseDown={(e) => {
                  // onMouseDown fires before blur, so we don't lose focus.
                  e.preventDefault()
                  applyCompletion(m.fullPath)
                }}
              >
                {m.name}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

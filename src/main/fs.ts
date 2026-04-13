import { readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { dirname, basename, join, isAbsolute } from 'path'

export interface DirMatch {
  name: string
  /** Full expanded absolute path (useful to verify selection). */
  fullPath: string
}

/**
 * Given a partial path string as a user would type it, return directory
 * entries in the partial's parent directory whose name starts with the
 * partial's final segment.
 *
 * Supports `~` expansion. Only accepts absolute paths or `~`-prefixed paths —
 * relative paths return empty since there's no meaningful cwd in a GUI.
 */
export function listDirs(partial: string): DirMatch[] {
  if (!partial) return []

  const expanded = expandTilde(partial)
  if (!isAbsolute(expanded)) return []

  // When the path ends with a separator, the user has committed to that
  // directory and wants to see its children (prefix is empty).
  const endsWithSep = partial.endsWith('/')
  const parentDir = endsWithSep ? expanded : dirname(expanded)
  const prefix = endsWithSep ? '' : basename(expanded)

  let entries: string[]
  try {
    entries = readdirSync(parentDir)
  } catch {
    return []
  }

  const matches: DirMatch[] = []
  const lowerPrefix = prefix.toLowerCase()
  for (const name of entries) {
    if (prefix && !name.toLowerCase().startsWith(lowerPrefix)) continue
    // Hide dotfiles unless the user is explicitly typing one.
    if (!prefix.startsWith('.') && name.startsWith('.')) continue
    const fullPath = join(parentDir, name)
    try {
      if (!statSync(fullPath).isDirectory()) continue
    } catch {
      continue
    }
    matches.push({ name, fullPath })
  }

  matches.sort((a, b) => a.name.localeCompare(b.name))
  return matches.slice(0, 50)
}

function expandTilde(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  return p
}

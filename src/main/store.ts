import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { Workspace, AtriumConfig } from '../shared/types'

const DIR = join(homedir(), '.atrium')
const WORKSPACES_FILE = join(DIR, 'workspaces.json')
const CONFIG_FILE = join(DIR, 'config.json')

function ensureDir(): void {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true })
}

export function listWorkspaces(): Workspace[] {
  ensureDir()
  if (!existsSync(WORKSPACES_FILE)) return []
  const workspaces = JSON.parse(readFileSync(WORKSPACES_FILE, 'utf-8'))
  let migrated = false
  for (const ws of workspaces) {
    // Migrate notes: string → NoteItem[]
    if (typeof ws.notes === 'string') {
      ws.notes = ws.notes.trim()
        ? [{ id: Date.now().toString(36), text: ws.notes, createdAt: ws.createdAt }]
        : []
      migrated = true
    }
    // Ensure links array exists and migrate old type → source/category
    if (!ws.links) {
      ws.links = []
      migrated = true
    }
    for (const link of ws.links) {
      if (!link.category) {
        const oldType = (link as any).type
        if (oldType === 'notion') { link.source = 'notion'; link.category = 'docs' }
        else if (oldType === 'linear') { link.source = 'linear'; link.category = 'tickets' }
        else if (oldType === 'github') { link.source = 'github'; link.category = 'other' }
        else { link.source = link.source ?? 'other'; link.category = 'other' }
        delete (link as any).type
        migrated = true
      }
    }
  }
  if (migrated) saveWorkspaces(workspaces)
  return workspaces
}

function saveWorkspaces(workspaces: Workspace[]): void {
  ensureDir()
  writeFileSync(WORKSPACES_FILE, JSON.stringify(workspaces, null, 2))
}

export function createWorkspace(
  data: Omit<Workspace, 'id' | 'createdAt' | 'updatedAt'>
): Workspace {
  const workspaces = listWorkspaces()
  const now = new Date().toISOString()
  const workspace: Workspace = {
    ...data,
    id: data.title
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, ''),
    createdAt: now,
    updatedAt: now
  }
  workspaces.push(workspace)
  saveWorkspaces(workspaces)
  return workspace
}

export function updateWorkspace(updated: Workspace): Workspace {
  const workspaces = listWorkspaces()
  const idx = workspaces.findIndex((w) => w.id === updated.id)
  if (idx === -1) throw new Error(`Workspace not found: ${updated.id}`)
  workspaces[idx] = { ...updated, updatedAt: new Date().toISOString() }
  saveWorkspaces(workspaces)
  return workspaces[idx]
}

export function deleteWorkspace(id: string): void {
  saveWorkspaces(listWorkspaces().filter((w) => w.id !== id))
}

// ── Watched PRs ────────────────────────────────────────────────────────────
export interface WatchedPR { number: number; repo: string }
const WATCHED_FILE = join(DIR, 'watched-prs.json')

export function listWatchedPRs(): WatchedPR[] {
  ensureDir()
  if (!existsSync(WATCHED_FILE)) return []
  return JSON.parse(readFileSync(WATCHED_FILE, 'utf-8'))
}

export function addWatchedPR(pr: WatchedPR): WatchedPR[] {
  const list = listWatchedPRs()
  if (!list.find((p) => p.number === pr.number && p.repo === pr.repo)) list.push(pr)
  writeFileSync(WATCHED_FILE, JSON.stringify(list, null, 2))
  return list
}

export function removeWatchedPR(num: number): WatchedPR[] {
  const list = listWatchedPRs().filter((p) => p.number !== num)
  writeFileSync(WATCHED_FILE, JSON.stringify(list, null, 2))
  return list
}

// ── Config ─────────────────────────────────────────────────────────────────
export function getConfig(): AtriumConfig {
  ensureDir()
  if (!existsSync(CONFIG_FILE)) {
    return {
      launchProfile: [{ type: 'terminal-tmux', app: 'ghostty' }],
      ghPath: '/opt/homebrew/bin/gh',
      setupComplete: false
    }
  }
  const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
  // Migrate old editor/terminal fields to launchProfile
  if (!config.launchProfile && (config.editor || config.terminal)) {
    const actions: any[] = []
    if (config.editor && config.editor !== 'none') {
      actions.push({ type: 'editor', app: config.editor })
    }
    if (config.terminal && config.terminal !== 'none') {
      actions.push({ type: 'terminal-tmux', app: config.terminal })
    }
    config.launchProfile = actions.length > 0 ? actions : [{ type: 'terminal-tmux', app: 'ghostty' }]
    delete config.editor
    delete config.terminal
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
  }
  return config
}

export function setConfig(partial: Partial<AtriumConfig>): AtriumConfig {
  ensureDir()
  const current = getConfig()
  const updated = { ...current, ...partial }
  writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2))
  return updated
}

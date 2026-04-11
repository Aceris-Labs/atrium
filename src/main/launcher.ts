import { spawn, execSync, spawnSync } from 'child_process'
import { getConfig } from './store'
import type { Workspace, LaunchAction } from '../shared/types'

const TERMINAL_BINS: Record<string, string> = {
  ghostty: '/Applications/Ghostty.app/Contents/MacOS/ghostty',
  iterm: 'iTerm',
  terminal: 'Terminal',
  warp: 'Warp'
}

const EDITOR_BINS: Record<string, string[]> = {
  cursor: ['cursor'],
  code: ['code']
}

export function launchWorkspace(workspace: Workspace): string {
  const { launchProfile } = getConfig()
  const sessionName = workspace.tmuxSession ?? workspace.id

  for (const action of launchProfile) {
    switch (action.type) {
      case 'editor':
        launchEditor(action.app, workspace.worktreePath)
        break
      case 'terminal-tmux':
        launchTerminalTmux(action.app, sessionName, workspace)
        break
      case 'terminal-cmd':
        launchTerminalCmd(action.app, action.command, workspace.worktreePath)
        break
    }
  }

  return sessionName
}

function launchEditor(app: string, worktreePath?: string): void {
  if (!worktreePath) return
  const bins = EDITOR_BINS[app] ?? [app]
  spawn(bins[0], ['--new-window', worktreePath], { detached: true, stdio: 'ignore' }).unref()
}

function launchTerminalTmux(app: string, sessionName: string, workspace: Workspace): void {
  if (!workspace.worktreePath) return

  // Create tmux session if needed
  if (!isTmuxSessionRunning(sessionName)) {
    const s = sessionName
    const dir = workspace.worktreePath

    spawnSync('tmux', ['new-session', '-d', '-s', s, '-c', dir])
    spawnSync('tmux', ['send-keys', '-t', s, 'nvim', 'Enter'])

    spawnSync('tmux', ['split-window', '-h', '-t', s, '-p', '40', '-c', dir])
    spawnSync('tmux', ['send-keys', '-t', s, buildClaudeCommand(workspace), 'Enter'])

    spawnSync('tmux', ['split-window', '-v', '-t', s, '-c', dir])

    spawnSync('tmux', ['select-pane', '-t', s, '-U'])
  }

  // Try switch-client first, fall back to opening a new terminal window
  const switched = spawnSync('tmux', ['switch-client', '-t', sessionName])
  if (switched.status !== 0) {
    openTerminalWithTmux(app, sessionName)
  }

  activateApp(app)
}

function launchTerminalCmd(app: string, command: string, worktreePath?: string): void {
  const dir = worktreePath ?? '~'

  switch (app) {
    case 'ghostty':
      spawn(TERMINAL_BINS.ghostty, ['-e', 'bash', '-c', `cd ${dir} && ${command}`], {
        detached: true, stdio: 'ignore'
      }).unref()
      break
    case 'warp':
    case 'iterm':
    case 'terminal': {
      const appName = TERMINAL_BINS[app]
      const script = app === 'iterm'
        ? `tell application "${appName}" to create window with default profile command "cd ${dir} && ${command}"`
        : `tell application "${appName}" to do script "cd ${dir} && ${command}"`
      spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' }).unref()
      break
    }
  }

  activateApp(app)
}

function openTerminalWithTmux(app: string, sessionName: string): void {
  switch (app) {
    case 'ghostty':
      spawn(TERMINAL_BINS.ghostty, ['-e', 'tmux', 'attach-session', '-t', sessionName], {
        detached: true, stdio: 'ignore'
      }).unref()
      break
    case 'iterm':
      spawn('osascript', ['-e',
        `tell application "iTerm" to create window with default profile command "tmux attach-session -t ${sessionName}"`
      ], { detached: true, stdio: 'ignore' }).unref()
      break
    case 'warp':
      spawn('osascript', ['-e',
        `tell application "Warp" to do script "tmux attach-session -t ${sessionName}"`
      ], { detached: true, stdio: 'ignore' }).unref()
      break
    case 'terminal':
      spawn('osascript', ['-e',
        `tell application "Terminal" to do script "tmux attach-session -t ${sessionName}"`
      ], { detached: true, stdio: 'ignore' }).unref()
      break
  }
}

function activateApp(app: string): void {
  const names: Record<string, string> = {
    ghostty: 'Ghostty', iterm: 'iTerm', terminal: 'Terminal', warp: 'Warp',
    cursor: 'Cursor', code: 'Visual Studio Code'
  }
  const name = names[app]
  if (name) {
    spawn('osascript', ['-e', `tell application "${name}" to activate`], {
      detached: true, stdio: 'ignore'
    }).unref()
  }
}

function buildClaudeCommand(workspace: Workspace): string {
  const lines: string[] = [`# Atrium Context: ${workspace.title}`, '']
  const todos = workspace.todos ?? []
  const pending = todos.filter((t) => !t.done)
  const done = todos.filter((t) => t.done)
  if (todos.length > 0) {
    lines.push('## Todos')
    pending.forEach((t) => lines.push(`- [ ] ${t.text}`))
    done.forEach((t) => lines.push(`- [x] ${t.text}`))
    lines.push('')
  }
  const noteItems = Array.isArray(workspace.notes) ? workspace.notes : []
  if (noteItems.length > 0) {
    lines.push('## Notes')
    noteItems.forEach((n: any) => lines.push(`- ${n.text}`))
    lines.push('')
  }
  if (workspace.prs.length > 0) {
    lines.push('## Linked PRs')
    workspace.prs.forEach((n) => lines.push(`- #${n}`))
    lines.push('')
  }
  if (workspace.branch) lines.push('## Branch', workspace.branch, '')
  const b64 = Buffer.from(lines.join('\n')).toString('base64')
  return `claude --resume --append-system-prompt "$(echo ${b64} | base64 -d)"`
}

export function stopSession(sessionName: string): void {
  if (isTmuxSessionRunning(sessionName)) {
    spawnSync('tmux', ['kill-session', '-t', sessionName])
  }
}

export function isTmuxSessionRunning(session: string): boolean {
  try {
    execSync(`tmux has-session -t ${session} 2>/dev/null`)
    return true
  } catch {
    return false
  }
}

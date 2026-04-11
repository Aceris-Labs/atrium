import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import type { DetectedTools, ToolStatus } from '../shared/types'

const GH_PATHS = ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh']

const EDITOR_APPS: Record<string, string[]> = {
  cursor: ['/Applications/Cursor.app/Contents/Resources/app/bin/cursor', '/usr/local/bin/cursor'],
  code: ['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code', '/usr/local/bin/code']
}

const TERMINAL_APPS: Record<string, string[]> = {
  ghostty: ['/Applications/Ghostty.app/Contents/MacOS/ghostty'],
  iterm: ['/Applications/iTerm.app/Contents/MacOS/iTerm2'],
  terminal: ['/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal'],
  warp: ['/Applications/Warp.app/Contents/MacOS/stable']
}

function findBinary(paths: string[]): string | undefined {
  return paths.find((p) => existsSync(p))
}

function whichBinary(name: string): string | undefined {
  const result = spawnSync('which', [name], { encoding: 'utf-8' })
  if (result.status === 0 && result.stdout.trim()) return result.stdout.trim()
  return undefined
}

function validateGh(): ToolStatus {
  const path = findBinary(GH_PATHS) ?? whichBinary('gh')
  if (!path) return { installed: false }

  // Check auth status
  const auth = spawnSync(path, ['auth', 'status'], { encoding: 'utf-8' })
  const output = (auth.stdout + auth.stderr).toLowerCase()
  const authenticated = auth.status === 0
  const usernameMatch = (auth.stdout + auth.stderr).match(/Logged in to github\.com.*?account\s+(\S+)/i)
    ?? (auth.stdout + auth.stderr).match(/(\S+)\s+\(/)
  const username = usernameMatch?.[1]

  return { installed: true, path, authenticated, username }
}

function validateClaude(): ToolStatus {
  const path = whichBinary('claude')
  if (!path) return { installed: false }

  const result = spawnSync(path, ['--version'], { encoding: 'utf-8' })
  const version = result.stdout?.trim() || undefined

  return { installed: true, path, version }
}

function validateEditor(name: string): ToolStatus {
  const paths = EDITOR_APPS[name] ?? []
  const path = findBinary(paths) ?? whichBinary(name)
  if (!path) return { installed: false }
  return { installed: true, path }
}

function validateTerminal(name: string): ToolStatus {
  const paths = TERMINAL_APPS[name] ?? []
  const path = findBinary(paths)
  if (!path) return { installed: false }
  return { installed: true, path }
}

export function detectTools(): DetectedTools {
  return {
    gh: validateGh(),
    claude: validateClaude(),
    editors: {
      cursor: validateEditor('cursor'),
      code: validateEditor('code')
    },
    terminals: {
      ghostty: validateTerminal('ghostty'),
      iterm: validateTerminal('iterm'),
      terminal: validateTerminal('terminal'),
      warp: validateTerminal('warp')
    }
  }
}

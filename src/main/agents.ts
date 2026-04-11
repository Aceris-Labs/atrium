import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { execSync } from 'child_process'

export type AgentStatus = 'working' | 'needs-input' | 'idle' | 'no-session'

const STATUS_DIR = join(homedir(), '.claude', 'workstream-status')

function readStatusFile(session: string): AgentStatus {
  const filePath = join(STATUS_DIR, session)
  if (!existsSync(filePath)) return 'no-session'
  try {
    const content = readFileSync(filePath, 'utf-8').trim()
    if (content === 'working') return 'working'
    if (content === 'needs-input') return 'needs-input'
    if (content === 'idle') return 'idle'
    return 'idle'
  } catch {
    return 'no-session'
  }
}

/** List tmux sessions that are actually running, with their Claude status */
export function listAvailableSessions(): { name: string; status: AgentStatus }[] {
  // Get live tmux sessions
  let liveSessions: Set<string>
  try {
    const raw = execSync('tmux list-sessions -F "#{session_name}"', { encoding: 'utf-8' })
    liveSessions = new Set(raw.trim().split('\n').filter(Boolean))
  } catch {
    return []
  }

  // Return only live sessions, with status from the hook files
  return [...liveSessions].map((name) => ({
    name,
    status: readStatusFile(name)
  }))
}

/**
 * Get agent statuses for workspaces.
 * @param sessions - map of workspace ID -> tmux session name
 */
export function getAgentStatuses(
  sessions: Record<string, string | undefined>
): Record<string, AgentStatus> {
  const result: Record<string, AgentStatus> = {}
  for (const [wsId, session] of Object.entries(sessions)) {
    result[wsId] = session ? readStatusFile(session) : 'no-session'
  }
  return result
}

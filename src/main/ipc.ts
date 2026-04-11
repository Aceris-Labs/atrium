import { ipcMain } from 'electron'
import { listWorkspaces, createWorkspace, updateWorkspace, deleteWorkspace, getConfig, setConfig, listWatchedPRs, addWatchedPR, removeWatchedPR } from './store'
import { listMyPRs, listReviewRequests, listTmuxSessions, fetchPR, getDefaultRepo } from './github'
import { launchWorkspace, stopSession } from './launcher'
import { listWorktrees, createWorktree } from './worktrees'
import { detectTools } from './setup'
import { getAgentStatuses, listAvailableSessions } from './agents'
import type { Workspace } from '../shared/types'

export function registerIpcHandlers(): void {
  ipcMain.handle('workspaces:list', () => listWorkspaces())
  ipcMain.handle('workspaces:create', (_, data: Omit<Workspace, 'id' | 'createdAt' | 'updatedAt'>) =>
    createWorkspace(data)
  )
  ipcMain.handle('workspaces:update', (_, workspace: Workspace) => updateWorkspace(workspace))
  ipcMain.handle('workspaces:delete', (_, id: string) => deleteWorkspace(id))

  ipcMain.handle('github:myPRs', () => listMyPRs())
  ipcMain.handle('github:reviewRequests', () => listReviewRequests())
  ipcMain.handle('github:tmuxSessions', () => listTmuxSessions())
  ipcMain.handle('github:fetchPR', (_, repo: string, number: number) => fetchPR(repo, number))
  ipcMain.handle('github:defaultRepo', () => getDefaultRepo())

  ipcMain.handle('workspace:launch', (_, workspace: Workspace) => launchWorkspace(workspace))
  ipcMain.handle('workspace:stop', (_, workspaceId: string) => stopSession(workspaceId))

  ipcMain.handle('agents:statuses', (_, sessions: Record<string, string | undefined>) =>
    getAgentStatuses(sessions)
  )
  ipcMain.handle('agents:sessions', () => listAvailableSessions())

  ipcMain.handle('watchedPRs:list', () => listWatchedPRs())
  ipcMain.handle('watchedPRs:add', (_, pr: { number: number; repo: string }) => addWatchedPR(pr))
  ipcMain.handle('watchedPRs:remove', (_, num: number) => removeWatchedPR(num))

  ipcMain.handle('config:get', () => getConfig())
  ipcMain.handle('config:set', (_, partial) => setConfig(partial))

  ipcMain.handle('setup:detect', () => detectTools())

  ipcMain.handle('worktrees:list', () => listWorktrees())
  ipcMain.handle('worktrees:create', (_, repoPath: string, name: string, branch: string, isNew: boolean) =>
    createWorktree(repoPath, name, branch, isNew)
  )
}

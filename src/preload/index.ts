import { contextBridge, ipcRenderer, shell } from 'electron'
import type { Workspace, WindowApi } from '../shared/types'

const api: WindowApi = {
  workspaces: {
    list: () => ipcRenderer.invoke('workspaces:list'),
    create: (data) => ipcRenderer.invoke('workspaces:create', data),
    update: (workspace) => ipcRenderer.invoke('workspaces:update', workspace),
    delete: (id) => ipcRenderer.invoke('workspaces:delete', id)
  },
  github: {
    myPRs: (repo?: string) => ipcRenderer.invoke('github:myPRs', repo),
    reviewRequests: () => ipcRenderer.invoke('github:reviewRequests'),
    tmuxSessions: () => ipcRenderer.invoke('github:tmuxSessions'),
    fetchPR: (repo: string, number: number) => ipcRenderer.invoke('github:fetchPR', repo, number),
    defaultRepo: () => ipcRenderer.invoke('github:defaultRepo')
  },
  workspace: {
    launch: (workspace: Workspace) => ipcRenderer.invoke('workspace:launch', workspace),
    stop: (workspaceId: string) => ipcRenderer.invoke('workspace:stop', workspaceId)
  },
  shell: {
    openExternal: (url: string) => shell.openExternal(url)
  },
  agents: {
    statuses: (sessions: Record<string, string | undefined>) => ipcRenderer.invoke('agents:statuses', sessions),
    sessions: () => ipcRenderer.invoke('agents:sessions')
  },
  watchedPRs: {
    list: () => ipcRenderer.invoke('watchedPRs:list'),
    add: (pr: { number: number; repo: string }) => ipcRenderer.invoke('watchedPRs:add', pr),
    remove: (num: number) => ipcRenderer.invoke('watchedPRs:remove', num)
  },
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (partial: object) => ipcRenderer.invoke('config:set', partial)
  },
  setup: {
    detect: () => ipcRenderer.invoke('setup:detect')
  },
  worktrees: {
    list: () => ipcRenderer.invoke('worktrees:list'),
    create: (repoPath: string, name: string, branch: string, isNew: boolean) =>
      ipcRenderer.invoke('worktrees:create', repoPath, name, branch, isNew)
  }
}

contextBridge.exposeInMainWorld('api', api)

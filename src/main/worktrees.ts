import { spawnSync } from 'child_process'
import { join } from 'path'
import { homedir } from 'os'
import { getConfig } from './store'
import { getReposInDirectory } from './github'
import type { WorktreeInfo } from '../shared/types'

export function listWorktrees(): WorktreeInfo[] {
  const { rootDir } = getConfig()
  if (!rootDir) return []

  const repos = getReposInDirectory(rootDir)
  const worktrees: WorktreeInfo[] = []

  for (const repo of repos) {
    const result = spawnSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repo.path,
      encoding: 'utf-8'
    })
    if (result.status !== 0) continue
    const repoName = repo.path.split('/').pop() ?? repo.repo
    worktrees.push(...parseWorktreeList(result.stdout, repoName, repo.path))
  }

  return worktrees
}

function parseWorktreeList(output: string, repoName: string, repoPath: string): WorktreeInfo[] {
  const home = homedir()
  const worktrees: WorktreeInfo[] = []
  const blocks = output.trim().split('\n\n')

  for (const block of blocks) {
    const lines = block.split('\n')
    const pathLine = lines.find((l) => l.startsWith('worktree '))
    const branchLine = lines.find((l) => l.startsWith('branch '))
    const detached = lines.some((l) => l === 'detached')

    if (!pathLine) continue

    const wtPath = pathLine.replace('worktree ', '')
    const branch = branchLine
      ? branchLine.replace('branch refs/heads/', '')
      : detached
        ? '(detached)'
        : 'unknown'

    worktrees.push({
      path: wtPath,
      displayPath: wtPath.replace(home, '~'),
      branch,
      repoName
    })
  }

  return worktrees
}

export function createWorktree(
  repoPath: string,
  name: string,
  branch: string,
  isNew: boolean
): WorktreeInfo {
  const dest = join(repoPath, '.claude', 'worktrees', name)

  const args = isNew
    ? ['worktree', 'add', dest, '-b', branch]
    : ['worktree', 'add', dest, branch]

  const result = spawnSync('git', args, {
    cwd: repoPath,
    encoding: 'utf-8'
  })

  if (result.status !== 0) {
    throw new Error(result.stderr || 'Failed to create worktree')
  }

  return {
    path: dest,
    displayPath: dest.replace(homedir(), '~'),
    branch,
    repoName: repoPath.split('/').pop() ?? ''
  }
}

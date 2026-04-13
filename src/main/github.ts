import { spawnSync, execSync } from 'child_process'
import { readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { getConfig, getWingRootDir } from './store'
import type { PRStatus, RepoInfo } from '../shared/types'

function gql(searchQuery: string): PRStatus[] {
  const { ghPath } = getConfig()

  const query = `
    query {
      search(query: "${searchQuery}", type: ISSUE, first: 50) {
        edges {
          node {
            ... on PullRequest {
              number
              title
              url
              isDraft
              reviewDecision
              mergeStateStatus
              autoMergeRequest { enabledAt }
              repository { nameWithOwner }
              author { login }
              commits(last: 1) {
                nodes { commit { statusCheckRollup { state } } }
              }
              reviewThreads(first: 100) {
                totalCount
                nodes { isResolved }
              }
            }
          }
        }
      }
    }
  `

  const result = spawnSync(ghPath, ['api', 'graphql', '-f', `query=${query}`], {
    encoding: 'utf-8'
  })

  if (result.status !== 0 || !result.stdout) return []

  try {
    const data = JSON.parse(result.stdout)
    return data.data.search.edges
      .map((e: any) => e.node)
      .filter((n: any) => n?.number != null)
      .map(mapNode)
  } catch {
    return []
  }
}

export function listMyPRs(wingId: string): PRStatus[] {
  return scopedPRQuery(wingId, 'is:pr is:open author:@me')
}

export function listReviewRequests(wingId: string): PRStatus[] {
  return scopedPRQuery(wingId, 'is:pr is:open review-requested:@me')
}

function scopedPRQuery(wingId: string, baseQuery: string): PRStatus[] {
  const rootDir = getWingRootDir(wingId)

  // No root dir configured → unbounded query across all of GitHub.
  // This is the "I haven't told you where my work lives" mode.
  if (!rootDir) return gql(baseQuery)

  // Root dir configured but no repos found → deliberately return nothing.
  // Falling back to an unbounded query here would be surprising: a user who
  // set a directory to scope their PRs should never see PRs from unrelated
  // repos just because the scan came up empty.
  const repos = getReposInDirectory(rootDir)
  if (repos.length === 0) return []

  // If all repos share the same owner, use `org:` (cleaner, handles forks).
  // Otherwise list each repo explicitly.
  const owners = [...new Set(repos.map((r) => r.repo.split('/')[0]))]
  const scope = owners.length === 1
    ? ` org:${owners[0]}`
    : ' ' + repos.map((r) => `repo:${r.repo}`).join(' ')
  return gql(baseQuery + scope)
}

export function getReposInDirectory(dir: string): RepoInfo[] {
  const expanded = dir.replace(/^~/, homedir())
  if (!existsSync(expanded)) return []

  // Case 1: the directory itself is a git repo. Use it directly and don't
  // also scan children — treating a repo as a "container of repos" would
  // produce spurious matches from submodules, nested checkouts, etc.
  if (existsSync(join(expanded, '.git'))) {
    const repo = readRepoRemote(expanded)
    return repo ? [{ path: expanded, repo }] : []
  }

  // Case 2: the directory is a container — scan its immediate children for
  // git repos.
  const repos: RepoInfo[] = []
  try {
    const entries = readdirSync(expanded, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const fullPath = join(expanded, entry.name)
      if (!existsSync(join(fullPath, '.git'))) continue
      const repo = readRepoRemote(fullPath)
      if (repo) repos.push({ path: fullPath, repo })
    }
  } catch {}

  return repos
}

function readRepoRemote(repoPath: string): string | null {
  try {
    const remote = execSync('git remote get-url origin 2>/dev/null', {
      cwd: repoPath,
      encoding: 'utf-8'
    }).trim()
    return parseGitRemote(remote)
  } catch {
    return null
  }
}

function parseGitRemote(url: string): string | null {
  const match = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)
  return match ? match[1] : null
}

export function getDefaultRepo(wingId: string): string | null {
  const rootDir = getWingRootDir(wingId)
  if (!rootDir) return null
  const repos = getReposInDirectory(rootDir)
  return repos.length > 0 ? repos[0].repo : null
}

export function fetchPR(repo: string, number: number): PRStatus | null {
  const { ghPath } = getConfig()
  const result = spawnSync(
    ghPath,
    ['pr', 'view', String(number), '--repo', repo,
     '--json', 'number,title,url,isDraft,reviewDecision,statusCheckRollup,state,reviewRequests'],
    { encoding: 'utf-8' }
  )
  if (result.status !== 0 || !result.stdout) return null
  try {
    const pr = JSON.parse(result.stdout)
    // gh pr view returns statusCheckRollup as an array of checks, not a single state
    const checks = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : []
    return {
      number: pr.number,
      title: pr.title,
      state: pr.state?.toLowerCase() ?? 'open',
      url: pr.url,
      isDraft: pr.isDraft ?? false,
      ciStatus: deriveCIFromChecks(checks),
      reviewDecision: pr.reviewDecision ?? null,
      openComments: 0,
      repo
    }
  } catch {
    return null
  }
}

export function listTmuxSessions(): string[] {
  try {
    const raw = execSync('tmux list-sessions -F "#{session_name}" 2>/dev/null', { encoding: 'utf-8' })
    return raw.trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

function mapNode(node: any): PRStatus {
  const ciState = node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null
  const threads = node.reviewThreads?.nodes ?? []
  const openComments = threads.filter((t: any) => !t.isResolved).length
  return {
    number: node.number,
    title: node.title,
    state: 'open',
    url: node.url,
    isDraft: node.isDraft ?? false,
    ciStatus: mapCIState(ciState),
    reviewDecision: node.reviewDecision ?? null,
    openComments,
    mergeState: node.mergeStateStatus ?? undefined,
    autoMerge: !!node.autoMergeRequest,
    author: node.author?.login,
    repo: node.repository?.nameWithOwner
  }
}

function deriveCIFromChecks(checks: any[]): PRStatus['ciStatus'] {
  if (checks.length === 0) return 'unknown'
  const hasFailure = checks.some((c) =>
    c.conclusion === 'FAILURE' || c.conclusion === 'ERROR' ||
    c.state === 'FAILURE' || c.state === 'ERROR'
  )
  if (hasFailure) return 'failure'
  const hasRunning = checks.some((c) =>
    c.status === 'IN_PROGRESS' || c.status === 'QUEUED' || c.status === 'PENDING' ||
    c.state === 'PENDING'
  )
  if (hasRunning) return 'pending'
  const allDone = checks.every((c) =>
    c.conclusion === 'SUCCESS' || c.conclusion === 'SKIPPED' || c.conclusion === 'NEUTRAL' ||
    c.state === 'SUCCESS'
  )
  if (allDone) return 'success'
  return 'unknown'
}

function mapCIState(state: string | null): PRStatus['ciStatus'] {
  if (!state) return 'unknown'
  if (state === 'SUCCESS') return 'success'
  if (state === 'FAILURE' || state === 'ERROR') return 'failure'
  if (state === 'PENDING' || state === 'EXPECTED') return 'pending'
  return 'unknown'
}

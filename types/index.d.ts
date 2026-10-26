export type GitSnapshot = {
  isRepo: boolean
  repo: string
  branch: string
  isDetached: boolean
  // True only while the upstream branch exists.
  hasUpstream: boolean
  isUpstreamGone: boolean
  ahead: number
  behind: number
  lastCommit: string
  // Status code per changed path, relative to the session's working directory.
  changes: Record<string, string>
  // Every changed path in the repo, including those outside the working directory.
  total: number
}

declare module 'claude-code' {
  interface PluginState {
    'work-tree-panel': {
      root: string
      expanded: Shaped<string[]>
      git: Shaped<GitSnapshot>
    }
  }
}

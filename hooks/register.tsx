import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { GitSnapshot } from '../types'

const PANE = 'work-tree'
const TITLE = 'Files'
const HIDDEN = new Set(['.git', '.DS_Store'])
const MAX_ROWS = 2000
// The engine draws a tree's first 100,000 characters; stop well short so no
// row is dropped silently.
const MAX_CHARS = 80_000
const POLL_MS = 5000
const AFTER_TOOL_MS = 300
// Bounds what is kept in $.state and compared on every poll.
const MAX_CHANGES = 5000

// C0 and C1 controls (the engine refuses a tree holding one) and bidi
// overrides (a shown name could differ from the copied one).
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/
const UNSAFE_CHARS_ALL = new RegExp(UNSAFE_CHARS.source, 'g')

// Repo content (file names, commit subjects, branch names) as it is drawn.
export function shown(text: string) {
  return text.replace(UNSAFE_CHARS_ALL, '\uFFFD')
}

export function isCopySafe(text: string) {
  return !UNSAFE_CHARS.test(text)
}

// Settings a repo's own config could use to run commands from these
// background calls. Hooks are already off for every engine git call.
const SAFE_GIT = [
  '-c',
  'core.fsmonitor=false',
  '-c',
  'log.showSignature=false',
  // A partial clone would lazily fetch missing objects through a remote
  // command the repo chooses. The repo's own protocol.<name>.allow outranks
  // this; SAFE_GIT_ENV is what blocks the fetch.
  '-c',
  'protocol.allow=never',
  '--no-optional-locks',
]
// Merged over the host environment for every call. GIT_NO_LAZY_FETCH (git
// 2.44+) stops the fetch; GIT_ALLOW_PROTOCOL (git 2.12+) outranks the repo's
// protocol settings, so no transport can start even on older git.
export const SAFE_GIT_ENV = { GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: 'none' }

// A Button key per path, one to one: backslash and unsafe characters become
// \uXXXX, so no two paths share a key.
export function keyOf(rel: string) {
  return rel.replace(/[\\\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, c =>
    `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
}

const NO_GIT: GitSnapshot = {
  isRepo: false,
  repo: '',
  branch: '',
  isDetached: false,
  hasUpstream: false,
  isUpstreamGone: false,
  ahead: 0,
  behind: 0,
  lastCommit: '',
  changes: {},
  total: 0,
  note: '',
}

const root = atom({ plugin: 'work-tree-panel', key: 'root' } as const, '')
// Change a tag when its value's fields change: it declines what an earlier
// version stored, which outlives a reload.
const expanded = atom(
  { plugin: 'work-tree-panel', key: 'expanded' } as const,
  [] as string[],
  { shape: 'expanded-1' },
)
const git = atom({ plugin: 'work-tree-panel', key: 'git' } as const, NO_GIT, {
  shape: 'git-3',
})

type Run = (
  argv: readonly string[],
) => Promise<{ exitCode: number; stdout: string; isStdoutTruncated?: boolean }>

// `-c` settings that blank each filter driver the repo itself defines (local
// or worktree config): status runs a filter's clean command when it re-reads
// a file. The person's own global filters (git-lfs) are left to work.
// `scoped` is `git config --show-scope -z --name-only` output: scope, name.
export function filtersOff(scoped: string) {
  const names = new Set<string>()
  const parts = scoped.split('\0')
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const scope = parts[i]
    const key = parts[i + 1] ?? ''
    if (scope !== 'local' && scope !== 'worktree') continue
    const name = key.slice('filter.'.length, key.lastIndexOf('.'))
    if (!key.startsWith('filter.') || !name) continue
    // `-c` splits at the first `=`, so such a name cannot be blanked.
    if (name.includes('=')) throw new Error('this repo defines a filter that cannot be switched off safely')
    names.add(name)
  }

  return [...names].flatMap(name => [
    '-c',
    `filter.${name}.clean=`,
    '-c',
    `filter.${name}.smudge=`,
    '-c',
    `filter.${name}.process=`,
    '-c',
    `filter.${name}.required=false`,
  ])
}

// Rejects when git status fails or is cut short, so the caller keeps the last
// good snapshot instead of drawing a false "clean".
// `startGrouped` skips the per-file untracked listing a previous run found
// too large.
export async function readGit(run: Run, startGrouped = false): Promise<GitSnapshot> {
  const [top, prefix] = await Promise.all([
    run(['git', ...SAFE_GIT, 'rev-parse', '--show-toplevel']),
    run(['git', ...SAFE_GIT, 'rev-parse', '--show-prefix']),
  ])
  if (top.exitCode !== 0 || prefix.exitCode !== 0) return NO_GIT
  const topDir = top.stdout.replace(/\n$/, '')
  const subDir = prefix.stdout.replace(/\n$/, '')

  const filters = await run([
    'git',
    ...SAFE_GIT,
    'config',
    '--show-scope',
    '-z',
    '--name-only',
    '--get-regexp',
    '^filter\\.',
  ])
  if (filters.isStdoutTruncated) throw new Error('too many filters to switch off')
  // Exit 1 means no filter is defined; anything else means the list is unknown.
  if (filters.exitCode !== 0 && filters.exitCode !== 1) throw new Error('could not list the repo filters')
  const off = filtersOff(filters.exitCode === 0 ? filters.stdout : '')
  const runGit = (...args: string[]) => run(['git', ...SAFE_GIT, ...off, ...args])
  const statusArgs = ['status', '--porcelain=v1', '--branch', '-z', '--ignore-submodules=dirty']
  const grouped = 'Untracked files are grouped by folder: too many to list.'

  const [first, log] = await Promise.all([
    runGit(...statusArgs, startGrouped ? '--untracked-files=normal' : '--untracked-files=all'),
    runGit('log', '-1', '--format=%h %s'),
  ])
  let status = first
  let note = startGrouped ? grouped : ''
  if (!startGrouped && status.exitCode === 0 && status.isStdoutTruncated) {
    // Too many untracked files to list one by one: list their folders.
    status = await runGit(...statusArgs, '--untracked-files=normal')
    note = grouped
  }
  if (status.exitCode !== 0) throw new Error(`git status exited ${status.exitCode}`)
  if (status.isStdoutTruncated) throw new Error('too many changes to read')

  const snapshot: GitSnapshot = {
    ...NO_GIT,
    isRepo: true,
    repo: topDir.split('/').pop() ?? topDir,
    lastCommit: log.exitCode === 0 ? log.stdout.trim() : '',
    changes: {},
    note,
  }
  let kept = 0

  const items = status.stdout.split('\0')
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!item) continue
    if (item.startsWith('## ')) {
      Object.assign(snapshot, parseBranch(item.slice(3)))
      continue
    }
    const x = item[0] ?? ' '
    const y = item[1] ?? ' '
    const path = item.slice(3)
    // A rename or copy, staged or not, is followed by its original path.
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') i++
    snapshot.total++
    if (!path.startsWith(subDir)) continue
    if (kept >= MAX_CHANGES) {
      const capped = `Status marks shown for the first ${MAX_CHANGES} changed files.`
      snapshot.note = note ? `${note} ${capped}` : capped
      continue
    }
    snapshot.changes[path.slice(subDir.length)] = statusCode(x, y)
    kept++
  }

  return snapshot
}

function statusCode(x: string, y: string) {
  if (x === '?') return '?'
  // Unmerged: either side U, or both added or both deleted.
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return 'U'
  // Gone from disk wins over a staged add, edit, rename or copy (`AD`, `MD`).
  if (y === 'D') return 'D'

  return x !== ' ' ? x : y
}

export function parseBranch(header: string): Partial<GitSnapshot> {
  if (header.startsWith('HEAD (no branch)')) return { branch: 'detached HEAD', isDetached: true }
  const [names = '', counts = ''] = header.split(' [')
  const unborn = names.match(/^(?:No commits yet|Initial commit) on (.+)$/)
  const [branch = names, upstream] = (unborn?.[1] ?? names).split('...')
  const isUpstreamGone = /\bgone\]?$/.test(counts)

  return {
    branch,
    hasUpstream: upstream !== undefined && !isUpstreamGone,
    isUpstreamGone,
    ahead: Number(counts.match(/ahead (\d+)/)?.[1] ?? 0),
    behind: Number(counts.match(/behind (\d+)/)?.[1] ?? 0),
  }
}

function statusColor(code: string) {
  if (code === 'D' || code === 'U') return 'error'
  if (code === 'A' || code === '?') return 'success'

  return 'warning'
}

let isRefreshing = false
let pending: { force: boolean } | undefined
// Set once a run found too many untracked files to list one by one; the full
// listing is tried again every GROUPED_RETRY runs, in case the pile is gone.
let isGrouped = false
let groupedRuns = 0
const GROUPED_RETRY = 12

// `force` writes even when nothing changed, so the tree re-lists after a
// tool that may have touched files git does not track. A request that comes
// in while one runs is folded into a single follow-up run.
async function refresh($: EngineInterface, force: boolean) {
  if (isRefreshing) {
    pending = { force: force || (pending?.force ?? false) }
    return
  }
  isRefreshing = true
  try {
    const cwd = await read($, root)
    if (!cwd) return
    groupedRuns = isGrouped ? groupedRuns + 1 : 0
    const next = await readGit(
      argv => $.process.run(argv, { cwd, env: SAFE_GIT_ENV, timeoutMs: 10_000 }),
      isGrouped && groupedRuns % GROUPED_RETRY !== 0,
    )
    isGrouped = next.note.startsWith('Untracked files are grouped')
    const current = await read($, git)
    if (force || JSON.stringify(current) !== JSON.stringify(next)) {
      await update($, git, () => next)
    }
  } catch (error) {
    // A failed git call leaves the last snapshot showing, with a note.
    const note = `Git status unavailable: ${error instanceof Error ? error.message : String(error)}`
    try {
      const current = await read($, git)
      if (current.note !== note) await update($, git, last => ({ ...last, note }))
    } catch {
      // Nothing more to show.
    }
  } finally {
    isRefreshing = false
    const again = pending
    pending = undefined
    if (again) void refresh($, again.force)
  }
}

let afterToolTimer: { cancel: () => void } | undefined
// Set once a surface can draw the pane: from session.start where one is
// attached, or from /files. Until then nothing polls or runs git.
let isWatching = false

// Background refreshes run git only while a surface draws the pane; /files
// refreshes it again when the pane comes back.
async function refreshIfShown($: EngineInterface, force: boolean) {
  try {
    const panes = await $.ui.panes()
    if (!panes.some(pane => pane.id === PANE && pane.isPlaced)) return
  } catch {
    return
  }
  await refresh($, force)
}

// Answers false when already watching.
function watch($: EngineInterface) {
  if (isWatching) return false
  isWatching = true
  void refresh($, true)
  $.clock.every(POLL_MS, () => void refreshIfShown($, false))

  return true
}

function refreshSoon($: EngineInterface) {
  if (!isWatching) return
  // Parallel tool calls share one refresh.
  afterToolTimer?.cancel()
  afterToolTimer = $.clock.after(AFTER_TOOL_MS, () => void refreshIfShown($, true))
}

type Entry = { name: string; kind: 'file' | 'dir' | 'other'; isGone: boolean }

// Deleted paths git still reports, as children of `dir` that a listing of the
// disk cannot show.
function goneChildren(gonePaths: readonly string[], dir: string) {
  const out = new Map<string, Entry>()
  const head = dir ? `${dir}/` : ''
  for (const path of gonePaths) {
    if (!path.startsWith(head)) continue
    const [name = '', ...rest] = path.slice(head.length).split('/')
    if (!out.has(name)) out.set(name, { name, kind: rest.length > 0 ? 'dir' : 'file', isGone: true })
  }

  return out
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await update($, root, () => e.cwd)
    await $.command.register({
      name: 'files',
      description: 'Show the file tree and git status in a side pane',
    })
    // A -p run has neither; the desktop app may attach a surface while not
    // counting as interactive.
    if (e.isInteractive || e.surface !== null) {
      watch($)
      void $.ui.open({ id: PANE, title: TITLE })
    }

    return next(e)
  })

  on('command.run', { command: 'files' }, async $ => {
    if (!watch($)) void refresh($, true)
    const opened = await $.ui.open({ id: PANE, title: TITLE, focus: true })

    return { text: opened.isPlaced ? 'Files pane opened.' : `Files pane is waiting: ${opened.reason}` }
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    try {
      refreshSoon($)
    } catch {
      // The tool's result stands whether or not the refresh was scheduled.
    }

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const cwd = await read($, root)
    const open = new Set(await read($, expanded))
    const info = await read($, git)

    const gonePaths = Object.keys(info.changes).filter(path => info.changes[path] === 'D')
    const dirtyDirs = new Set<string>()
    for (const path of Object.keys(info.changes)) {
      const parts = path.split('/')
      for (let n = 1; n < parts.length; n++) dirtyDirs.add(parts.slice(0, n).join('/'))
    }

    const toggle = (rel: string) => () =>
      void update($, expanded, list =>
        list.includes(rel) ? list.filter(p => p !== rel) : [...list, rel],
      )
    const copy = (rel: string) => async (press: { surface: typeof e.surface }) => {
      if (!rel) return
      // A newline would run a second command when pasted into a shell.
      if (!isCopySafe(rel)) {
        $.ui.toast('Not copied: the name holds control or text-direction characters.')
        return
      }
      const copied = await $.ui.copy({ text: rel, surface: press.surface })
      $.ui.toast(copied.isCopied ? `Copied ${rel}` : `Could not copy: ${copied.reason}`)
    }

    const rows: RenderChildren[] = []
    let chars = 0
    let isCut = false
    const walk = async (dir: string, depth: number) => {
      const indent = '  '.repeat(depth)
      const gone = goneChildren(gonePaths, dir)
      let entries: Entry[] = []
      try {
        const listed = await $.fs.list(dir ? `${cwd}/${dir}` : cwd)
        entries = listed.map(entry => ({ name: entry.name, kind: entry.kind, isGone: false }))
      } catch {
        if (gone.size === 0) {
          rows.push(<Text dimColor>{indent}(cannot read)</Text>)
          return
        }
      }
      for (const entry of entries) gone.delete(entry.name)
      entries = [...entries, ...gone.values()]
        .filter(entry => !HIDDEN.has(entry.name))
        .sort((a, b) =>
          a.kind === 'dir' && b.kind !== 'dir'
            ? -1
            : b.kind === 'dir' && a.kind !== 'dir'
              ? 1
              : a.name.localeCompare(b.name),
        )
      for (const entry of entries) {
        if (rows.length >= MAX_ROWS || chars >= MAX_CHARS) {
          isCut = true
          return
        }
        const rel = dir ? `${dir}/${entry.name}` : entry.name
        const label = shown(entry.name)
        const key = keyOf(rel)
        const code = info.changes[rel]
        chars += indent.length + label.length + 10
        if (entry.kind === 'dir') {
          const isOpen = open.has(rel)
          rows.push(
            <Box flexDirection="row">
              {depth > 0 && <Text>{indent}</Text>}
              <Button key={`d:${key}`} plain onPress={toggle(rel)}>
                {isOpen ? '▾ ' : '▸ '}
                <Text strikethrough={entry.isGone}>{label}/</Text>
                {code && <Text color={statusColor(code)}> {code}</Text>}
                {!code && dirtyDirs.has(rel) && <Text color="warning"> •</Text>}
              </Button>
              <Button key={`c:${key}`} plain onPress={copy(rel)}>
                <Text dimColor> copy</Text>
              </Button>
            </Box>,
          )
          if (isOpen) await walk(rel, depth + 1)
        } else {
          rows.push(
            <Box flexDirection="row">
              {depth > 0 && <Text>{indent}</Text>}
              <Button key={`f:${key}`} plain onPress={copy(rel)}>
                {'  '}
                <Text strikethrough={entry.isGone}>{label}</Text>
                {code && <Text color={statusColor(code)}> {code}</Text>}
              </Button>
            </Box>,
          )
        }
      }
    }
    if (cwd) await walk('', 0)

    const folder = shown(cwd.split('/').pop() || cwd)

    return (
      <Box flexDirection="column">
        {info.isRepo ? (
          <Box flexDirection="column">
            <Text wrap="truncate-end">
              <Text bold>{shown(info.repo)}</Text>
              <Text color="suggestion"> {shown(info.branch)}</Text>
              {info.ahead > 0 && <Text color="success"> ↑{info.ahead}</Text>}
              {info.behind > 0 && <Text color="warning"> ↓{info.behind}</Text>}
              {info.isUpstreamGone && <Text color="warning"> (upstream gone)</Text>}
              {!info.isDetached && !info.hasUpstream && !info.isUpstreamGone && (
                <Text dimColor> (no upstream)</Text>
              )}
            </Text>
            {info.lastCommit && (
              <Text dimColor wrap="truncate-end">
                {shown(info.lastCommit)}
              </Text>
            )}
            <Text color={info.total > 0 ? 'warning' : 'success'}>
              {info.total > 0
                ? `${info.total} changed file${info.total === 1 ? '' : 's'}`
                : 'Working tree clean'}
            </Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            <Text bold>{folder}</Text>
            {!info.note && <Text dimColor>Not a git repository</Text>}
          </Box>
        )}
        {info.note && <Text color="warning">{shown(info.note)}</Text>}
        <Box flexDirection="row">
          <Button key="refresh" hotkey="r" plain onPress={() => void refresh($, true)}>
            <Text dimColor>refresh</Text>
          </Button>
          <Button key="copy-root" plain onPress={copy(cwd)}>
            <Text dimColor>  copy full path</Text>
          </Button>
        </Box>
        <Text> </Text>
        {rows.length === 0 && cwd && <Text dimColor>Empty folder.</Text>}
        {rows}
        {isCut && <Text dimColor>… tree too large to show whole; collapse a folder.</Text>}
      </Box>
    )
  })
}

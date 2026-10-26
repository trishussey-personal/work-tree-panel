import { expect, test } from 'claude-code/testing'

import { parseBranch, readGit } from '../hooks/register'

const PANE = {
  plugin: 'work-tree-panel',
  component: 'Pane',
  requestId: 'work-tree',
  props: {
    title: 'Files',
    isFocused: true,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const STATUS = [
  '## main...origin/main [ahead 2, behind 1]',
  ' M src/app.ts',
  'A  src/new.ts',
  '?? notes.md',
  'R  src/b.ts',
  'src/a.ts',
  ' M ../outside.txt',
  ' D src/old.ts',
  'AD src/tmp.ts',
  'UD src/conflict.ts',
  '',
].join('\0')

function fakeGit(argv: readonly string[], prefix = '') {
  const sub = argv[1]
  if (sub === 'rev-parse') return { exitCode: 0, stdout: `/code/demo\n${prefix}\n`, stderr: '' }
  if (sub === 'status') return { exitCode: 0, stdout: STATUS, stderr: '' }
  if (sub === 'log') return { exitCode: 0, stdout: 'abc1234 First commit\n', stderr: '' }

  return { exitCode: 1, stdout: '', stderr: '' }
}

const FILES: Record<string, { name: string; kind: 'file' | 'dir' }[]> = {
  '/code/demo': [
    { name: 'notes.md', kind: 'file' },
    { name: 'src', kind: 'dir' },
    { name: '.git', kind: 'dir' },
  ],
  '/code/demo/src': [
    { name: 'app.ts', kind: 'file' },
    { name: 'new.ts', kind: 'file' },
  ],
}

test('git status is read into branch, counts and per-file codes', async () => {
  const snapshot = await readGit(async argv => fakeGit(argv))

  expect(snapshot.isRepo).toBe(true)
  expect(snapshot.repo).toBe('demo')
  expect(snapshot.branch).toBe('main')
  expect(snapshot.ahead).toBe(2)
  expect(snapshot.behind).toBe(1)
  expect(snapshot.lastCommit).toBe('abc1234 First commit')
  expect(snapshot.total).toBe(8)
  expect(snapshot.changes['src/old.ts']).toBe('D')
  expect(snapshot.changes['src/tmp.ts']).toBe('D')
  expect(snapshot.changes['src/conflict.ts']).toBe('U')
  expect(snapshot.changes['src/app.ts']).toBe('M')
  expect(snapshot.changes['src/new.ts']).toBe('A')
  expect(snapshot.changes['notes.md']).toBe('?')
  expect(snapshot.changes['src/b.ts']).toBe('R')
  expect(snapshot.changes['src/a.ts']).toBe(undefined)
})

test('paths are made relative to a working directory below the repo root', async () => {
  const snapshot = await readGit(async argv => fakeGit(argv, 'src/'))

  expect(snapshot.changes['app.ts']).toBe('M')
  expect(snapshot.changes['notes.md']).toBe(undefined)
  expect(snapshot.total).toBe(8)
})

test('a folder outside git says so', async () => {
  const snapshot = await readGit(async () => ({ exitCode: 128, stdout: '' }))

  expect(snapshot.isRepo).toBe(false)
})

test('an unborn branch is named', async () => {
  const snapshot = await readGit(async argv =>
    argv[1] === 'status'
      ? { exitCode: 0, stdout: '## No commits yet on main\0' }
      : argv[1] === 'log'
        ? { exitCode: 128, stdout: '' }
        : fakeGit(argv),
  )

  expect(snapshot.branch).toBe('main')
  expect(snapshot.lastCommit).toBe('')
})

test('a worktree-side rename skips its original path', async () => {
  const snapshot = await readGit(async argv =>
    argv[1] === 'status'
      ? { exitCode: 0, stdout: '## main\0 R new file.txt\0old.txt\0' }
      : fakeGit(argv),
  )

  expect(snapshot.total).toBe(1)
  expect(snapshot.changes).toEqual({ 'new file.txt': 'R' })
})

test('a failed or truncated git status rejects so the last snapshot stays', async () => {
  const failed = readGit(async argv =>
    argv[1] === 'status' ? { exitCode: 128, stdout: '' } : fakeGit(argv),
  )
  await expect(failed).rejects.toThrow()

  const cut = readGit(async argv =>
    argv[1] === 'status' ? { exitCode: 0, stdout: STATUS, isStdoutTruncated: true } : fakeGit(argv),
  )
  await expect(cut).rejects.toThrow()
})

test('branch headers: gone upstream, unborn with upstream, detached, old git', () => {
  expect(parseBranch('main...origin/main [gone]')).toMatchObject({
    branch: 'main',
    hasUpstream: false,
    isUpstreamGone: true,
  })
  expect(parseBranch('No commits yet on main...origin/main')).toMatchObject({
    branch: 'main',
    hasUpstream: true,
  })
  expect(parseBranch('HEAD (no branch)')).toMatchObject({ isDetached: true })
  expect(parseBranch('Initial commit on dev')).toMatchObject({ branch: 'dev', hasUpstream: false })
  expect(parseBranch('feature')).toMatchObject({ branch: 'feature', hasUpstream: false })
})

test('the tree draws, a folder expands, and a file path copies', async ($, on) => {
  const copied: string[] = []
  on('command.register', () => ({ value: { command: 'files' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', (_, e) => ({
    value: { ...fakeGit(e.argv), isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('fs.list', (_, e) => ({
    value: (FILES[e.path] ?? []).map(f => ({ ...f, size: 0, mtimeMs: 0, isLink: false })),
  }))
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.toast', () => ({ value: undefined }))

  await $.session.start({ cwd: '/code/demo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'refresh' })

  expect((await ui.find({ type: 'Text', text: /changed files/ }))?.text).toBe('8 changed files')
  expect(await ui.find({ key: 'd:src' })).toBeDefined()
  expect(await ui.find({ key: 'd:.git' })).toBe(undefined)
  expect(await ui.find({ key: 'f:src/app.ts' })).toBe(undefined)

  await ui.press({ key: 'd:src' })
  expect(await ui.find({ key: 'f:src/app.ts' })).toBeDefined()
  // Deleted on disk, still reported by git.
  expect(await ui.find({ key: 'f:src/old.ts' })).toBeDefined()

  await ui.press({ key: 'f:src/app.ts' })
  await ui.press({ key: 'c:src' })
  expect(copied).toEqual(['src/app.ts', 'src'])

  await ui.press({ key: 'd:src' })
  expect(await ui.find({ key: 'f:src/app.ts' })).toBe(undefined)
  await ui.unmount()
})

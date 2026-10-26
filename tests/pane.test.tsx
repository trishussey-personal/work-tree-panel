import { expect, test } from 'claude-code/testing'

import { filtersOff, isCopySafe, parseBranch, readGit, shown } from '../hooks/register'

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

// The git subcommand, past the global options every call carries.
function sub(argv: readonly string[]) {
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '-c') i++
    else if (!argv[i]?.startsWith('-')) return argv[i]
  }

  return undefined
}

function fakeGit(argv: readonly string[], prefix = '') {
  if (sub(argv) === 'rev-parse') {
    const stdout = argv.includes('--show-toplevel') ? '/code/demo\n' : `${prefix}\n`
    return { exitCode: 0, stdout, stderr: '' }
  }
  if (sub(argv) === 'status') return { exitCode: 0, stdout: STATUS, stderr: '' }
  if (sub(argv) === 'log') return { exitCode: 0, stdout: 'abc1234 First commit\n', stderr: '' }

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
    sub(argv) === 'status'
      ? { exitCode: 0, stdout: '## No commits yet on main\0' }
      : sub(argv) === 'log'
        ? { exitCode: 128, stdout: '' }
        : fakeGit(argv),
  )

  expect(snapshot.branch).toBe('main')
  expect(snapshot.lastCommit).toBe('')
})

test('a worktree-side rename skips its original path', async () => {
  const snapshot = await readGit(async argv =>
    sub(argv) === 'status'
      ? { exitCode: 0, stdout: '## main\0 R new file.txt\0old.txt\0' }
      : fakeGit(argv),
  )

  expect(snapshot.total).toBe(1)
  expect(snapshot.changes).toEqual({ 'new file.txt': 'R' })
})

test('a failed or truncated git status rejects so the last snapshot stays', async () => {
  const failed = readGit(async argv =>
    sub(argv) === 'status' ? { exitCode: 128, stdout: '' } : fakeGit(argv),
  )
  await expect(failed).rejects.toThrow()

  const cut = readGit(async argv =>
    sub(argv) === 'status' ? { exitCode: 0, stdout: STATUS, isStdoutTruncated: true } : fakeGit(argv),
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

test('every git call switches off config that could run commands', async () => {
  const calls: (readonly string[])[] = []
  await readGit(async argv => {
    calls.push(argv)
    if (sub(argv) === 'config') return { exitCode: 0, stdout: 'filter.lfs.clean\0filter.lfs.smudge\0filter.evil.process\0' }
    return fakeGit(argv)
  })

  for (const argv of calls) {
    expect(argv).toContain('core.fsmonitor=false')
    expect(argv).toContain('--no-optional-locks')
  }
  const status = calls.find(argv => sub(argv) === 'status') ?? []
  expect(status).toContain('filter.evil.clean=')
  expect(status).toContain('filter.lfs.process=')
  expect(status).toContain('--ignore-submodules=dirty')
  const log = calls.find(argv => sub(argv) === 'log') ?? []
  expect(log).toContain('log.showSignature=false')
})

test('filter names with dots are blanked whole', () => {
  expect(filtersOff('filter.a.b.clean\0')).toContain('filter.a.b.clean=')
  expect(filtersOff('')).toEqual([])
})

test('too many untracked files falls back to listing their folders', async () => {
  const snapshot = await readGit(async argv => {
    if (sub(argv) === 'status' && argv.includes('--untracked-files=all')) {
      return { exitCode: 0, stdout: '', isStdoutTruncated: true }
    }
    if (sub(argv) === 'status') return { exitCode: 0, stdout: '## main\0?? build/\0' }
    return fakeGit(argv)
  })

  expect(snapshot.changes['build/']).toBe('?')
  expect(snapshot.note).toMatch(/grouped by folder/)
})

test('the kept changes are capped', async () => {
  const many = Array.from({ length: 5003 }, (_, n) => `?? f${n}.txt`)
  const snapshot = await readGit(async argv =>
    sub(argv) === 'status' ? { exitCode: 0, stdout: ['## main', ...many, ''].join('\0') } : fakeGit(argv),
  )

  expect(snapshot.total).toBe(5003)
  expect(Object.keys(snapshot.changes)).toHaveLength(5000)
  expect(snapshot.note).toMatch(/first 5000/)
})

test('control and direction characters are shown replaced and never copied', () => {
  expect(shown('a\u001b[2Jb\nc\u202ed')).toBe('a\uFFFD[2Jb\uFFFDc\uFFFDd')
  expect(shown('plain name.ts')).toBe('plain name.ts')
  expect(isCopySafe('src/app.ts')).toBe(true)
  expect(isCopySafe('x\nrm -rf ~')).toBe(false)
  expect(isCopySafe('evil\u202etxt.exe')).toBe(false)
})

test('a hostile file name and commit subject still draw, and the name is not copied', async ($, on) => {
  const copied: string[] = []
  const toasts: string[] = []
  const hostile = 'a\u001b[2Jb\nrm -rf ~'
  on('command.register', () => ({ value: { command: 'files' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', (_, e) => ({
    value: {
      ...(sub(e.argv) === 'log'
        ? { exitCode: 0, stdout: 'abc1234 \u001b]52;c;ZXZpbA==\u0007 subject\n', stderr: '' }
        : fakeGit(e.argv)),
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('fs.list', () => ({ value: [{ name: hostile, kind: 'file', size: 0, mtimeMs: 0, isLink: false }] }))
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  await $.session.start({ cwd: '/code/demo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'refresh' })

  expect((await ui.find({ type: 'Text', text: /subject/ }))?.text).toContain('\uFFFD')
  const key = `f:${shown(hostile)}`
  expect(await ui.find({ key })).toBeDefined()
  await ui.press({ key })
  expect(copied).toEqual([])
  expect(toasts.at(-1)).toMatch(/Not copied/)
  await ui.unmount()
})

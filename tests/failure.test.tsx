import { expect, test } from 'claude-code/testing'

// Its own file: the mod's module-level refresh flags would otherwise carry
// over from the other tests.

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

function sub(argv: readonly string[]) {
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '-c') i++
    else if (!argv[i]?.startsWith('-')) return argv[i]
  }

  return undefined
}

function fakeGit(argv: readonly string[]) {
  if (sub(argv) === 'rev-parse') {
    return { exitCode: 0, stdout: argv.includes('--show-toplevel') ? '/code/demo\n' : '\n', stderr: '' }
  }
  if (sub(argv) === 'status') return { exitCode: 128, stdout: '', stderr: '' }

  return { exitCode: 1, stdout: '', stderr: '' }
}

test('a git failure on first run shows the reason, not "Not a git repository"', async ($, on) => {
  on('command.register', () => ({ value: { command: 'files' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', (_, e) => ({
    value: {
      ...fakeGit(e.argv),
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('fs.list', () => ({ value: [] }))

  // Mounted first so the drawing is subscribed before the first refresh writes.
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.session.start({ cwd: '/code/demo', surface: 'terminal', isInteractive: true })
  // Refreshes run in the background: press until the note lands.
  let note
  for (let tries = 0; tries < 20 && !note; tries++) {
    await ui.press({ key: 'refresh' })
    note = await ui.find({ type: 'Text', text: /unavailable/ })
  }

  expect(note?.text).toMatch(/Git status unavailable/)
  expect(await ui.find({ type: 'Text', text: /Not a git repository/ })).toBe(undefined)
  await ui.unmount()
})

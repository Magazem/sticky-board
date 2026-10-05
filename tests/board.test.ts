import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const TOOL = 'mcp__sticky-board__board'
const HOME = 'C:\\Users\\me'
const FILE = 'C:\\Users\\me\\.sticky\\notes.json' // as the host spells it
const REPO = 'C:\\Users\\me\\Documents\\Shop'
const HERE = 'c:\\users\\me\\documents\\shop'

const note = (id: string, lane: string, title: string, extra: object = {}) => ({
  id, lane, title, priority: 3, status: 'open', project: HERE, created_at: id, updated_at: id, ...extra,
})

const FULL = [
  note('01', 'scope', 'phase 0 spike'),
  note('02', 'scope', 'phase 1: public beta'),
  note('03', 'todo', 'wire retries into uploader', { priority: 2, area: 'api' }),
  note('04', 'todo', 'second ai item'),
  note('05', 'human', 'rotate the API key', { priority: 1 }),
  note('06', 'feature', 'old planned item'),
  note('07', 'todo', 'finished item', { status: 'done' }),
  { ...note('08', 'todo', 'other project item'), project: 'c:\\users\\me\\elsewhere' },
]

type World = {
  files: Map<string, string>
  ran: string[][]
  opened: string[]
  toasts: string[]
  status: (string | undefined)[]
  sent: string[][]
  shown: boolean
}

// The machine beneath the plugin: an in-memory file system, git, panes, store.
function world(on: On, notes: object[] | string, opts: { git?: string; store?: Record<string, unknown> } = {}): World {
  const w: World = {
    files: new Map([[FILE, typeof notes === 'string' ? notes : JSON.stringify(notes)]]),
    ran: [], opened: [], toasts: [], status: [], sent: [], shown: false,
  }
  let mtime = 1
  mock.clock(on, { now: Date.UTC(2026, 9, 5) })
  mock.env(on, { USERPROFILE: HOME })
  mock.store(on, opts.store ?? {})
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__sticky-board__${e.name}` } }))
  on('ui.open', (_$, e) => {
    w.opened.push(e.id)
    w.shown = true
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => {
    w.shown = false
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: w.shown ? [{ id: 'sticky-board', title: 'Sticky Board', isShown: true, isFocused: false, isPlaced: true }] : [],
  }))
  on('ui.toast', (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_$, e) => {
    w.status.push(e.text)
    return { value: undefined }
  })
  on('fs.exists', (_$, e) => ({ value: w.files.has(e.path) }))
  on('fs.stat', (_$, e) =>
    w.files.has(e.path)
      ? { value: { kind: 'file', size: w.files.get(e.path)!.length, mtimeMs: mtime, isLink: false } }
      : { deny: 'ENOENT' },
  )
  on('fs.read', (_$, e) => (w.files.has(e.path) ? { value: w.files.get(e.path)! } : { deny: 'ENOENT' }))
  on('fs.write', (_$, e) => {
    w.files.set(e.path, e.text)
    mtime += 1
    return { value: undefined }
  })
  on('process.run', (_$, e) => {
    w.ran.push([...e.argv])
    const isCommonDir = e.argv.includes('--git-common-dir')
    const out = opts.git && isCommonDir ? `${opts.git}\n` : ''
    return {
      value: { exitCode: out ? 0 : 128, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
  on('prompt.submit', (_$, e) => {
    w.sent.push([...(e.context ?? [])])
    return { text: e.text, context: e.context }
  })
  return w
}

const saved = (w: World) => JSON.parse(w.files.get(FILE)!) as any[]
const call = ($: any, input: object) => $.tool.call({ tool: TOOL, ...input })
const start = ($: any, cwd = REPO, surface: 'terminal' | 'desktop' = 'terminal') =>
  $.session.start({ cwd, surface, isInteractive: true })
const mountPane = ($: any, surface: 'terminal' | 'desktop') =>
  $.ui.mount({
    plugin: 'sticky-board', surface, component: 'Pane', props: {}, requestId: 'sticky-board',
    viewport: { columns: 40, rows: 30 },
  })

for (const surface of ['terminal', 'desktop'] as const) {
  test(`pane: phase line, tabs, and a click ticks an item off (${surface})`, async ($, on) => {
    const w = world(on, FULL)
    // A worktree of the repo shares the repo's board.
    await start($, `${REPO}\\.claude\\worktrees\\feature-x`, surface)
    const ui = await mountPane($, surface)

    expect(await ui.find({ text: 'phase 1: public beta' })).toBeDefined()
    expect(await ui.find({ text: 'phase 0 spike' })).toBeUndefined()
    expect(await ui.find({ key: 'toggle-06' })).toBeUndefined() // legacy lane
    expect(await ui.find({ key: 'toggle-08' })).toBeUndefined() // other project

    // The AI list is focused: its open items, then the recently finished one.
    expect(await ui.find({ key: 'toggle-03' })).toBeDefined()
    expect(await ui.find({ key: 'toggle-07' })).toBeDefined()
    expect(await ui.find({ key: 'toggle-05' })).toBeUndefined()

    await ui.press({ key: 'tab-human' })
    expect(await ui.find({ key: 'toggle-05' })).toBeDefined()
    expect(await ui.find({ key: 'toggle-03' })).toBeUndefined()

    await ui.press({ key: 'toggle-05' })
    expect(saved(w).find(n => n.id === '05').status).toBe('done')
    expect(saved(w)).toHaveLength(FULL.length)
  })

  test(`pane: an empty board stays small (${surface})`, async ($, on) => {
    world(on, [])
    await start($, REPO, surface)
    const ui = await mountPane($, surface)

    expect(await ui.find({ text: 'no phase set' })).toBeDefined()
    expect(await ui.find({ text: 'nothing queued' })).toBeDefined()
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(4) // × and three tabs
  })
}

test('tool: add, dedupe, phase, done and list', async ($, on) => {
  const w = world(on, [])
  await start($)

  expect((await call($, { action: 'add', list: 'ai', title: 'wire retries into uploader.' })).result).toContain('Added to AI to-do')
  expect((await call($, { action: 'add', list: 'ai', title: 'Wire retries into uploader', priority: 1 })).result).toContain('Updated')
  await call($, { action: 'add', list: 'you', title: 'rotate the API key' })
  await call($, { action: 'add', list: 'bugs', title: 'webhook fires twice', area: 'api' })
  await call($, { action: 'scope', title: 'phase 1: retries' })
  await call($, { action: 'scope', title: 'phase 2: public beta' })

  const notes = saved(w)
  expect(notes.filter(n => n.lane === 'todo')).toHaveLength(1)
  expect(notes.find(n => n.lane === 'todo').priority).toBe(1)
  expect(notes.find(n => n.lane === 'todo').title).toBe('wire retries into uploader')
  expect(notes.find(n => n.lane === 'todo').project).toBe(HERE)
  expect(notes.filter(n => n.lane === 'scope' && n.status === 'open').map(n => n.title)).toEqual(['phase 2: public beta'])
  expect(w.toasts).toEqual(['For you: rotate the API key'])

  expect((await call($, { action: 'done', title: 'webhook' })).result).toBe('Done: webhook fires twice')
  expect(saved(w).find(n => n.lane === 'bug').status).toBe('done')
  expect((await call($, { action: 'reopen', title: 'webhook fires twice' })).result).toContain('Reopened')

  const listed = (await call($, { action: 'list' })).result as string
  expect(listed).toContain('Phase: phase 2: public beta')
  expect(listed).toContain('AI to-do (1): ! wire retries into uploader')
  expect(listed).toContain('Bugs (1): webhook fires twice [api]')
})

test('tool: unclear requests are refused with what exists', async ($, on) => {
  world(on, FULL)
  await start($)

  const missing = await call($, { action: 'done', title: 'deploy to prod' })
  expect(missing.deny).toContain('no item matches')
  expect(missing.deny).toContain('wire retries into uploader')
  expect((await call($, { action: 'add', title: 'no list given' })).deny).toContain('needs list')
  expect((await call($, { action: 'done', title: 'i' })).deny).toContain('several items match')
})

test('tool: a corrupt board is never overwritten', async ($, on) => {
  const w = world(on, '{ not json')
  await start($)

  expect((await call($, { action: 'add', list: 'ai', title: 'anything' })).deny).toBeDefined()
  expect(w.files.get(FILE)).toBe('{ not json')
})

test('Claude sees the board on its first prompt and again only after a change', async ($, on) => {
  const w = world(on, FULL)
  await start($)

  await $.prompt.submit({ text: 'hi', wait: false } as never)
  expect(w.sent[0]!.join('\n')).toContain('Phase: phase 1: public beta')
  expect(w.sent[0]!.join('\n')).toContain('You (1): ! rotate the API key')

  await $.prompt.submit({ text: 'again', wait: false } as never)
  expect(w.sent[1]).toEqual([])

  // Claude's own write needs no re-send; the person's click does.
  await call($, { action: 'add', list: 'ai', title: 'new ai item' })
  await $.prompt.submit({ text: 'next', wait: false } as never)
  expect(w.sent[2]).toEqual([])

  const ui = await mountPane($, 'terminal')
  await ui.press({ key: 'toggle-04' })
  await $.prompt.submit({ text: 'after click', wait: false } as never)
  expect(w.sent[3]!.join('\n')).toContain('Sticky Board for Shop')
})

test('an empty board adds nothing to the prompt', async ($, on) => {
  const w = world(on, [])
  await start($)
  await $.prompt.submit({ text: 'hi', wait: false } as never)
  expect(w.sent[0]).toEqual([])
})

test('/sticky toggles the pane, and a close is remembered', async ($, on) => {
  const w = world(on, FULL)
  await start($)
  expect(w.opened).toEqual(['sticky-board'])

  expect((await $.command.run({ command: 'sticky', args: '' } as never)).text).toContain('hidden')
  // Closed, the counts move to the status line.
  expect(w.status.at(-1)).toBe('▤ AI 2 · You 1')
  // The next session remembers the close.
  await start($)
  expect(w.opened).toEqual(['sticky-board'])

  expect((await $.command.run({ command: 'sticky', args: '' } as never)).text).toContain('Shop')
  expect(w.opened).toHaveLength(2)
  expect(w.status.at(-1)).toBeUndefined()
  // And remembers the reopen.
  await start($)
  expect(w.opened).toHaveLength(3)
})

test('a pane closed in an earlier session stays closed', async ($, on) => {
  const w = world(on, FULL, { store: { autoOpen: false } })
  await start($)
  expect(w.opened).toEqual([])
})

test('a subfolder of a git repo uses the repo board', async ($, on) => {
  const w = world(on, FULL, { git: 'C:/Users/me/Documents/Shop/.git' })
  await start($, `${REPO}\\src\\deep`)
  await call($, { action: 'add', list: 'ai', title: 'from a subfolder' })

  expect(saved(w).find(n => n.title === 'from a subfolder').project).toBe(HERE)
  expect(w.ran.some(argv => argv[0] === 'git')).toBe(true)
})

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, Note } from '../types'

// Sticky Board: a small pane with the current project's phase and three short
// lists: what Claude still has to do, what only you can do, and known bugs.
//
// Claude keeps it current through the `board` tool registered below; you read it
// at a glance and click an item to tick it off. Everything lives in one JSON file,
// ~/.sticky/notes.json (or $STICKY_HOME/notes.json), one board per project.

const PANE = 'sticky-board'
const TOOL = 'mcp__sticky-board__board'
const POLL_MS = 2000
const WIDTH = 40 // columns asked for when docked beside a fullscreen transcript
const MAX_ROWS = 10 // the list never grows past this; the rest is "+N more"
const MAX_DONE = 2 // recently ticked items stay visible, dim, so a mis-click undoes
const MAX_SEEN = 8 // items per list in what Claude is shown

type Lane = 'todo' | 'human' | 'bug'

const LISTS: { key: Lane; name: string; label: string; hotkey: string; empty: string }[] = [
  { key: 'todo', name: 'ai', label: 'AI', hotkey: '1', empty: 'nothing queued' },
  { key: 'human', name: 'you', label: 'You', hotkey: '2', empty: 'nothing needs you' },
  { key: 'bug', name: 'bugs', label: 'Bugs', hotkey: '3', empty: 'no known bugs' },
]
const LANE_OF: Record<string, Lane> = { ai: 'todo', you: 'human', bugs: 'bug' }
const LABEL_OF: Record<string, string> = { todo: 'AI to-do', human: 'You', bug: 'Bugs' }

const board = atom({ plugin: 'sticky-board', key: 'board' } as const, {
  projectName: '',
  notes: [],
  error: null,
})
const focus = atom({ plugin: 'sticky-board', key: 'focus' } as const, 'todo')

const DESCRIPTION = `The Sticky Board: a small pane the user keeps open beside this session, showing this project's current phase and three short lists. The user reads it at a glance, so keep it accurate and terse.

Lists:
- ai: work you still have to do in this project
- you: things only the user can do (decide, rotate a key, test by hand, create an account, review)
- bugs: known defects not yet fixed

Actions:
- add: file an item (list and title; optional priority 1-3 where 1 blocks work, area such as ui or api). Adding a title that is already open updates it.
- done: tick an item off by its title (a unique part of it is enough). Do this as soon as you finish one of your items.
- reopen: undo a done.
- scope: set the one-line phase, e.g. "phase 2: public beta". It replaces the previous line.
- list: read the board.

File when something durable happens: a bug found, work discovered or deferred, something handed to the user, the phase changing. At the end of a code review, file each real finding under bugs. If the board has no phase yet and you understand what the project is doing, set one. Do not file routine progress, passing tests or restatements of a plan.

Style: titles are fragments of 3-6 words with no trailing punctuation ("webhook fires twice on 500s"), never sentences.`

const SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['add', 'done', 'reopen', 'scope', 'list'] },
    list: { type: 'string', enum: ['ai', 'you', 'bugs'], description: 'Which list, for add; optional for done and reopen.' },
    title: { type: 'string', description: 'A 3-6 word fragment.' },
    priority: { type: 'integer', minimum: 1, maximum: 3, description: '1 blocks work; 3 is the default.' },
    area: { type: 'string', description: 'Optional short tag, e.g. ui, api, build.' },
  },
  required: ['action'],
  additionalProperties: false,
}

// Mirrors how projects were always named: a path, lowercased on Windows with
// backslashes, so one project stays one board however it was opened.
const SPLITS = ['\\.claude\\worktrees\\', '\\.claude\\jobs\\', '/.claude/worktrees/', '/.claude/jobs/']

function projectOf(dir: string) {
  let p = dir.trim()
  for (const marker of SPLITS) {
    const at = p.indexOf(marker)
    if (at !== -1) p = p.slice(0, at)
  }
  p = p.replace(/[\\/]+$/, '')
  const isWindows = /^[A-Za-z]:/.test(p) || p.includes('\\')
  if (isWindows) p = p.replace(/\//g, '\\')
  const name = p.split(/[\\/]/).pop() || p

  return { id: isWindows ? p.toLowerCase() : p, name }
}

// A board belongs to the repository, not to the folder Claude was started in: a
// subfolder or a worktree of a repo shares the repo's board.
async function resolveProject($: EngineInterface, cwd: string) {
  const git = async (...args: string[]) => {
    const ran = await $.process.run(['git', ...args], { timeoutMs: 5000 }).catch(() => undefined)
    return ran?.exitCode === 0 ? ran.stdout.trim() : ''
  }
  const common = await git('rev-parse', '--path-format=absolute', '--git-common-dir')
  if (/[\\/]\.git$/.test(common)) return projectOf(common.replace(/[\\/]\.git$/, ''))
  const top = await git('rev-parse', '--show-toplevel')

  return projectOf(top || cwd)
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

const byPriority = (a: Note, b: Note) =>
  a.priority - b.priority || a.created_at.localeCompare(b.created_at)

const isOpenIn = (lane: string) => (n: Note) => n.lane === lane && n.status !== 'done'

function newId() {
  const c = (globalThis as any).crypto
  if (c?.randomUUID) return c.randomUUID() as string
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
}

// Module variables start over on a hot reload; session.start sets them again.
let root = ''
let project = { id: '', name: '' }
let lastMtime = -1
let lastSeen = '' // the board as Claude last saw it, so it is only re-sent on change
let lastStatus: string | undefined | null = null
let writes: Promise<unknown> = Promise.resolve()

const notesPath = () => `${root}/notes.json`

function toNote(n: any): Note {
  return {
    id: String(n.id),
    lane: n.lane ?? 'cue',
    title: String(n.title ?? ''),
    detail: n.detail ?? null,
    area: n.area ?? null,
    priority: Number.isFinite(n.priority) ? n.priority : 3,
    status: n.status ?? 'open',
    created_at: String(n.created_at ?? ''),
    updated_at: String(n.updated_at ?? n.created_at ?? ''),
  }
}

// A missing file is an empty board; an unreadable one throws, so a write can never
// replace a board it failed to read.
async function loadAll($: EngineInterface): Promise<any[]> {
  if (!(await $.fs.exists(notesPath()))) return []
  const all = JSON.parse((await $.fs.read(notesPath())).replace(/^﻿/, ''))
  if (!Array.isArray(all)) throw new Error('notes.json is not a list')
  return all
}

async function refresh($: EngineInterface, force = false) {
  const stat = await $.fs.stat(notesPath()).catch(() => undefined)
  if (!stat) {
    lastMtime = 0
    await update($, board, () => ({ projectName: project.name, notes: [], error: null }))
    return
  }
  if (!force && stat.mtimeMs === lastMtime) return

  try {
    const all = await loadAll($)
    lastMtime = stat.mtimeMs
    const notes = all.filter(n => (n.project ?? null) === (project.id || null)).map(toNote)
    await update($, board, () => ({ projectName: project.name, notes, error: null }))
  } catch {
    // A half-written or corrupt file keeps the last good board on screen.
    await update($, board, b => ({ ...b, error: 'notes.json unreadable' }))
  }
}

// Every write re-reads the file, changes it and writes it back, one at a time.
function mutate<T>($: EngineInterface, change: (all: any[], now: string) => T): Promise<T> {
  const run = writes.then(async () => {
    const all = await loadAll($)
    const now = new Date(await $.clock.now()).toISOString()
    const out = change(all, now)
    await $.fs.write(notesPath(), JSON.stringify(all, null, 2) + '\n')
    await refresh($, true)
    return out
  })
  writes = run.catch(() => undefined)

  return run
}

const toggle = ($: EngineInterface, id: string) =>
  mutate($, (all, now) => {
    const n = all.find(x => x.id === id)
    if (!n) return
    n.status = n.status === 'done' ? 'open' : 'done'
    n.updated_at = now
  })

function snapshot(b: Board) {
  const scope = b.notes.filter(isOpenIn('scope')).sort((x, y) => y.created_at.localeCompare(x.created_at))[0]
  const line = (lane: Lane) => {
    const items = b.notes.filter(isOpenIn(lane)).sort(byPriority)
    const shown = items.slice(0, MAX_SEEN).map(n => (n.priority === 1 ? '! ' : '') + n.title + (n.area ? ` [${n.area}]` : ''))
    const more = items.length > MAX_SEEN ? [`+${items.length - MAX_SEEN} more`] : []

    return `${LABEL_OF[lane]} (${items.length}): ${items.length ? [...shown, ...more].join('; ') : 'none'}`
  }

  return [
    `Sticky Board for ${b.projectName || 'this folder'}`,
    `Phase: ${scope?.title ?? 'not set'}`,
    line('todo'),
    line('human'),
    line('bug'),
  ].join('\n')
}

const isBlank = (b: Board) => !b.notes.some(n => n.status !== 'done' && ['scope', 'todo', 'human', 'bug'].includes(n.lane))

async function runTool($: EngineInterface, input: Record<string, unknown>): Promise<string> {
  const action = String(input.action ?? '')
  const title = String(input.title ?? '').trim().replace(/[.!]+$/, '')
  const lane = input.list === undefined ? undefined : LANE_OF[String(input.list)]
  const here = (n: any) => (n.project ?? null) === (project.id || null)

  if (action === 'list') {
    const b: Board = await read($, board)
    lastSeen = snapshot(b)
    return lastSeen
  }
  if (!title) throw new Error(`${action} needs a title`)

  if (action === 'scope') {
    await mutate($, (all, now) => {
      for (const n of all) {
        if (here(n) && n.lane === 'scope' && n.status !== 'done') {
          n.status = 'done'
          n.updated_at = now
        }
      }
      all.push({
        id: newId(), created_at: now, updated_at: now, lane: 'scope', project: project.id || null,
        project_name: project.name || null, area: null, priority: 1, category: 'scope', title,
        detail: null, status: 'open', session_id: 'claude',
      })
    })
    lastSeen = snapshot(await read($, board))
    return `Phase set: ${title}`
  }

  if (action === 'add') {
    if (!lane) throw new Error('add needs list: ai, you or bugs')
    const priority = Number.isInteger(input.priority) ? Math.min(3, Math.max(1, input.priority as number)) : undefined
    const area = typeof input.area === 'string' && input.area.trim() ? input.area.trim() : undefined
    const isNew = await mutate($, (all, now) => {
      const same = all.find(n => here(n) && n.lane === lane && n.status !== 'done' && norm(String(n.title ?? '')) === norm(title))
      if (same) {
        if (priority) same.priority = priority
        if (area) same.area = area
        same.updated_at = now
        return false
      }
      all.push({
        id: newId(), created_at: now, updated_at: now, lane, project: project.id || null,
        project_name: project.name || null, area: area ?? null, priority: priority ?? 3, category: lane,
        title, detail: null, status: 'open', session_id: 'claude',
      })
      return true
    })
    if (isNew && lane === 'human') $.ui.toast(`For you: ${title}`, { timeoutMs: 8000 })
    lastSeen = snapshot(await read($, board))
    return `${isNew ? 'Added to' : 'Updated in'} ${LABEL_OF[lane]}: ${title}`
  }

  if (action === 'done' || action === 'reopen') {
    const wantsDone = action === 'done'
    const b: Board = await read($, board)
    const pool = b.notes.filter(
      n => ['todo', 'human', 'bug'].includes(n.lane) && (lane ? n.lane === lane : true) && (n.status === 'done') !== wantsDone,
    )
    const exact = pool.filter(n => norm(n.title) === norm(title))
    const partial = pool.filter(n => norm(n.title).includes(norm(title)))
    const hits = exact.length ? exact : partial
    if (hits.length !== 1) {
      const names = (hits.length ? hits : pool).slice(0, 12).map(n => `${n.title} (${LABEL_OF[n.lane]})`)
      throw new Error(
        `${hits.length ? 'several items match' : 'no item matches'} "${title}". ${wantsDone ? 'Open' : 'Done'} items: ${names.join('; ') || 'none'}`,
      )
    }
    await toggle($, hits[0]!.id)
    lastSeen = snapshot(await read($, board))
    return `${wantsDone ? 'Done' : 'Reopened'}: ${hits[0]!.title}`
  }

  throw new Error(`unknown action "${action}"`)
}

// Without the pane on screen (closed, or a terminal too narrow for it), one line
// under the prompt keeps the counts in view.
async function syncStatus($: EngineInterface) {
  const b: Board = await read($, board)
  const panes = await $.ui.panes().catch(() => [])
  const isShown = panes.some(p => p.id === PANE && p.isPlaced && p.isShown)
  const parts = LISTS.map(l => [l.label, b.notes.filter(isOpenIn(l.key)).length] as const)
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label} ${count}`)
  const text = isShown || parts.length === 0 ? undefined : `▤ ${parts.join(' · ')}`
  if (text === lastStatus) return
  lastStatus = text
  $.ui.status(text)
}

async function openPane($: EngineInterface) {
  const b: Board = await read($, board)
  const lane = await read($, focus)
  const open = b.notes.filter(isOpenIn(lane)).length
  const rows = 5 + Math.min(Math.max(open, 1), MAX_ROWS)

  return $.ui.open({ id: PANE, title: 'Sticky Board', columns: WIDTH, rows })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const home = (await $.env.get('STICKY_HOME')) ?? `${(await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''}/.sticky`
    root = home.replace(/[\\/]+$/, '')
    project = await resolveProject($, e.cwd)
    lastMtime = -1
    lastSeen = ''
    lastStatus = null

    await $.tool.register({ name: 'board', description: DESCRIPTION, inputSchema: SCHEMA })
    await $.command.register({
      name: 'sticky',
      description: 'Show or hide the Sticky Board for this project',
      argumentHint: '[open|close]',
    })
    await refresh($, true)
    $.clock.every(POLL_MS, async () => {
      await refresh($)
      await syncStatus($)
    })
    if ((await $.store.get('autoOpen')) !== false) void openPane($)

    return next(e)
  })

  // Claude sees the board on its first prompt, and again whenever it changed by
  // some other hand (a click in the pane, another session) since it last looked.
  on('prompt.submit', async ($, e, next) => {
    const b: Board = await read($, board)
    const snap = snapshot(b)
    if (isBlank(b) || snap === lastSeen) return next(e)
    lastSeen = snap

    return next({ ...e, context: [...(e.context ?? []), `<sticky-board>\n${snap}\n</sticky-board>`] })
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    try {
      return { result: await runTool($, e as unknown as Record<string, unknown>) }
    } catch (err) {
      return { deny: `Sticky Board: ${err instanceof Error ? err.message : String(err)}` }
    }
  })

  // A close by hand, by the × or by /sticky is remembered: the pane stays shut in
  // later sessions until /sticky opens it again.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind !== 'unload') await $.store.set('autoOpen', false)
    lastStatus = null
    return next(e)
  })

  on('command.run', { command: 'sticky' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const panes = await $.ui.panes()
    const isShown = panes.some(p => p.id === PANE && p.isPlaced && p.isShown)
    const wantsOpen = arg === 'open' || (arg !== 'close' && !isShown)

    if (!wantsOpen) {
      await $.ui.close({ id: PANE })
      await syncStatus($)
      return { text: 'Sticky Board hidden. /sticky brings it back.' }
    }
    await $.store.set('autoOpen', true)
    await refresh($, true)
    await openPane($)
    await syncStatus($)

    return { text: `Sticky Board: ${project.name || 'this folder'}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const b: Board = await read($, board)
    const focused = await read($, focus)
    const list = LISTS.find(l => l.key === focused) ?? LISTS[0]!

    const scope = b.notes.filter(isOpenIn('scope')).sort((x, y) => y.created_at.localeCompare(x.created_at))[0]
    const open = b.notes.filter(isOpenIn(list.key)).sort(byPriority)
    const done = b.notes
      .filter(n => n.lane === list.key && n.status === 'done')
      .sort((x, y) => y.updated_at.localeCompare(x.updated_at))
      .slice(0, MAX_DONE)

    const room = Math.max(3, Math.min(MAX_ROWS, (e.viewport?.rows ?? 20) - 6))
    const shown = open.slice(0, room)
    const hidden = open.length - shown.length
    const width = Math.max(8, Math.min(WIDTH, e.viewport?.columns ?? WIDTH))

    const item = (n: Note) => {
      const isDone = n.status === 'done'
      const isUrgent = !isDone && n.priority === 1

      return (
        <Box key={`row-${n.id}`}>
          <Text color={isUrgent ? 'warning' : 'inactive'}>{isDone ? '✓ ' : isUrgent ? '! ' : '· '}</Text>
          <Button key={`toggle-${n.id}`} plain dimColor={isDone} label={n.title} onPress={() => toggle($, n.id)} />
          {n.area && !isDone && <Text dimColor> {n.area}</Text>}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box justifyContent="space-between">
          <Text dimColor>{b.projectName || 'this folder'}</Text>
          <Button key="close" plain dimColor role="dismiss" hotkey="x" label="×" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
        {scope ? <Text wrap="truncate-end">{scope.title}</Text> : <Text dimColor>no phase set</Text>}
        {b.error && <Text color="error">{b.error}</Text>}

        <Box marginTop={1}>
          {LISTS.map(l => {
            const count = b.notes.filter(isOpenIn(l.key)).length
            const isFocused = l.key === list.key

            return (
              <Box key={`tab-box-${l.key}`} marginRight={2}>
                <Button
                  key={`tab-${l.key}`}
                  plain
                  hotkey={l.hotkey}
                  dimColor={!isFocused}
                  label={count ? `${l.label} ${count}` : l.label}
                  onPress={() => update($, focus, () => l.key)}
                />
              </Box>
            )
          })}
        </Box>
        <Text color="inactive">{'─'.repeat(width - 2)}</Text>

        {open.length === 0 && <Text dimColor>{list.empty}</Text>}
        {shown.map(item)}
        {hidden > 0 && <Text dimColor>+{hidden} more</Text>}
        {done.map(item)}
      </Box>
    )
  })
}

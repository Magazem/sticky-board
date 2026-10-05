// The Claude Code terminal as a paper cut-out, with the Sticky Board pane docked
// on the right. Everything in it (transcript, tabs, counts, list order, ticks)
// is a function of time, driven by the same timeline as the narration.

import { HITS, T } from '../shared/timeline'
import {
  Pt, TAU, clamp, deg, easeInOutCubic, easeInQuad, easeOutCubic, lerp, mix, prog, spring, wobble,
} from './core'
import { FONTS, HILITE, INK, arrow, handText, ink, loop, tick, underline } from './ink'
import { Sprite, bake, cutout, outline, paperFill, polyPath, tape } from './paper'
import { clickRings, confetti, hand, pencil } from './props'

export const TERM = { x: 280, y: 1280, w: 1360, h: 760, rot: deg(-0.6) }
const FS = 21
const CW = 12.6
const LH = 31
const C = {
  bg: '#252120',
  bar: '#332d29',
  text: '#ede5d7',
  dim: '#8f877c',
  faint: '#615a53',
  user: '#bdb4a7',
  claude: '#e58a62',
  green: '#7fc98c',
  warn: '#f4b44a',
  border: '#5d564f',
}
const PANE = { x0: 806, y0: 70, x1: 1334, y1: 470 }
const PX = PANE.x0 + 20
const rowY = (r: number) => PANE.y0 + 40 + r * LH

let body: Sprite
let mini: Sprite
let toastSprite: Sprite
let labels: Record<string, Sprite> = {}
let tapes: Sprite[] = []

// --- monospace text with hand-drawn terminal glyphs ---

type Seg = [string, string, boolean?]

function glyph(g: CanvasRenderingContext2D, ch: string, x: number, y: number, color: string, size = FS) {
  const k = size / FS
  const cx = x + (CW * k) / 2
  const cy = y - 7 * k
  g.fillStyle = color
  g.strokeStyle = color
  g.lineWidth = 1.8 * k
  g.lineCap = 'round'
  switch (ch) {
    case '⏺':
      g.beginPath()
      g.arc(cx, cy, 4.6 * k, 0, TAU)
      g.fill()
      break
    case '⎿':
      g.beginPath()
      g.moveTo(x + 3 * k, y - 20 * k)
      g.lineTo(x + 3 * k, y - 6 * k)
      g.lineTo(x + CW * k * 1.4, y - 6 * k)
      g.stroke()
      break
    case '·':
      g.beginPath()
      g.arc(cx, cy, 2.3 * k, 0, TAU)
      g.fill()
      break
    case '✓':
      g.lineWidth = 2.4 * k
      g.beginPath()
      g.moveTo(cx - 5 * k, cy)
      g.lineTo(cx - 1.5 * k, cy + 4.5 * k)
      g.lineTo(cx + 6 * k, cy - 6 * k)
      g.stroke()
      break
    case '×':
      g.beginPath()
      g.moveTo(cx - 5 * k, cy - 5 * k)
      g.lineTo(cx + 5 * k, cy + 5 * k)
      g.moveTo(cx + 5 * k, cy - 5 * k)
      g.lineTo(cx - 5 * k, cy + 5 * k)
      g.stroke()
      break
    case '─':
      g.beginPath()
      g.moveTo(x, cy)
      g.lineTo(x + CW * k, cy)
      g.stroke()
      break
    case '▌':
      g.fillRect(x + 1, y - 19 * k, CW * k - 2, 24 * k)
      break
    default:
      g.fillText(ch, x, y)
  }
}

// Writes segments on the grid; `reveal` (0..1) types them on.
function mono(g: CanvasRenderingContext2D, segs: Seg[], x: number, y: number, reveal = 1, size = FS) {
  const k = size / FS
  const total = segs.reduce((n, s) => n + s[0].length, 0)
  let budget = Math.floor(total * clamp(reveal))
  let col = 0
  for (const [text, color, bold] of segs) {
    g.font = `${bold ? 700 : 400} ${size}px "${FONTS.mono}"`
    g.fillStyle = color
    let run = ''
    let runCol = col
    const flush = () => {
      if (run) g.fillText(run, x + runCol * CW * k, y)
      run = ''
    }
    for (const ch of text) {
      if (budget-- <= 0) break
      if (ch.charCodeAt(0) < 128) {
        if (!run) runCol = col
        run += ch
      } else {
        flush()
        glyph(g, ch, x + col * CW * k, y, color, size)
      }
      col++
    }
    flush()
    if (budget <= 0) break
  }
}

// --- the pane's data, as it changes over the film ---

type Lane = 'ai' | 'you' | 'bugs'
type Item = { id: string; lane: Lane; title: string; area?: string; pri: number; born: number; doneAt?: number }

const ITEMS: Item[] = [
  { id: 'wire', lane: 'ai', title: 'wire retries into uploader', area: 'api', pri: 2, born: -3, doneAt: T.ticks + 0.4 },
  { id: 'pag', lane: 'ai', title: 'paginate the orders page', area: 'ui', pri: 3, born: -2 },
  { id: 'cache', lane: 'ai', title: 'cache product thumbnails', pri: 3, born: -1 },
  { id: 'tests', lane: 'ai', title: 'add retry tests', pri: 3, born: T.files + 0.05 },
  { id: 'copy', lane: 'you', title: 'approve the pricing copy', pri: 3, born: -1, doneAt: T.tick + 0.38 },
  { id: 'secret', lane: 'you', title: 'rotate leaked webhook secret', pri: 1, born: T.lands },
  { id: 'twice', lane: 'bugs', title: 'webhook fires twice on 500s', area: 'api', pri: 2, born: -2 },
  { id: 'loops', lane: 'bugs', title: 'login redirect loops', area: 'ui', pri: 3, born: -1 },
]

const isOpen = (it: Item, t: number) => it.born <= t && !(it.doneAt !== undefined && it.doneAt <= t)
const count = (lane: Lane, t: number) => ITEMS.filter(it => it.lane === lane && isOpen(it, t)).length

function order(lane: Lane, t: number) {
  const open = ITEMS.filter(it => it.lane === lane && isOpen(it, t)).sort((a, b) => a.pri - b.pri || a.born - b.born)
  const done = ITEMS.filter(it => it.lane === lane && it.doneAt !== undefined && it.doneAt <= t)
    .sort((a, b) => b.doneAt! - a.doneAt!)
    .slice(0, 2)
  return [...open, ...done]
}

// Rows glide to their new place for a moment after each change.
function rowOf(it: Item, t: number) {
  const now = order(it.lane, t).indexOf(it)
  const changes = ITEMS.filter(x => x.lane === it.lane)
    .flatMap(x => [x.born, x.doneAt ?? -99])
    .filter(c => c > 0 && c <= t)
  const last = Math.max(-99, ...changes)
  const k = prog(t, last, 0.32)
  if (k >= 1 || last < 0) return now
  const before = order(it.lane, last - 1e-3).indexOf(it)
  if (before === -1) return now
  return lerp(before, now, easeInOutCubic(k))
}

// Which list the pane shows.
const FOCUS: [number, Lane][] = [
  [-99, 'ai'],
  [T.listYou - 0.05, 'you'],
  [T.listBugs - 0.05, 'bugs'],
  [T.current - 0.6, 'ai'],
  [T.lands - 0.12, 'you'],
]

function focusAt(t: number) {
  let i = 0
  while (i + 1 < FOCUS.length && FOCUS[i + 1]![0] <= t) i++
  return { lane: FOCUS[i]![1], since: FOCUS[i]![0], prev: FOCUS[Math.max(0, i - 1)]![1] }
}

// --- baking ---

export function bakeTerminal() {
  const { w, h } = TERM
  body = bake(w, h, g => {
    const pts = outline(w, h, 91, {}, 0)
    paperFill(g, pts, C.bg, { seed: 91, shade: 0.5 })
    g.save()
    g.clip(polyPath(pts))
    g.fillStyle = C.bar
    g.fillRect(0, 0, w, 48)
    g.fillStyle = 'rgba(0,0,0,0.25)'
    g.fillRect(0, 48, w, 2)
    ;['#e5534b', '#e9b949', '#5bb974'].forEach((c, i) => {
      g.fillStyle = c
      g.beginPath()
      g.arc(30 + i * 28, 24, 8.5, 0, TAU)
      g.fill()
      g.fillStyle = 'rgba(255,255,255,0.25)'
      g.beginPath()
      g.arc(27 + i * 28, 21, 3, 0, TAU)
      g.fill()
    })
    g.font = `400 17px "${FONTS.mono}"`
    g.fillStyle = C.dim
    g.textAlign = 'center'
    g.fillText('claude — ~/code/shop', w / 2, 30)
    g.restore()
  })
  mini = bake(600, 380, g => {
    const pts = outline(600, 380, 92, {}, 0)
    paperFill(g, pts, C.bg, { seed: 92, shade: 0.5 })
    g.save()
    g.clip(polyPath(pts))
    g.fillStyle = C.bar
    g.fillRect(0, 0, 600, 38)
    ;['#e5534b', '#e9b949', '#5bb974'].forEach((c, i) => {
      g.fillStyle = c
      g.beginPath()
      g.arc(24 + i * 22, 19, 7, 0, TAU)
      g.fill()
    })
    g.restore()
  })
  toastSprite = cutout(540, 70, '#fff3b0', 93, {})
  const label = (text: string, color: string, w: number, seed: number) =>
    cutout(w, 74, color, seed, {
      torn: { r: true },
      content: g => handText(g, text, 18, 52, { size: 46, jitter: 0, seed }),
    })
  labels = {
    phase: label('the phase', '#fbf7ef', 220, 94),
    lists: label('3 short lists', '#f5a3b7', 268, 95),
    ai: label("Claude's to-do", '#ffe066', 286, 96),
    you: label('only you', '#9fd3f2', 200, 97),
    bugs: label('known bugs', '#b2e3a6', 244, 98),
  }
  tapes = [tape(96, 30, 110), tape(88, 28, 111), tape(80, 28, 112), tape(92, 30, 113), tape(84, 28, 114)]
}

// --- the scene-1 session window: text racing by ---

const SESSION: Seg[][] = [
  [['> ', C.user], ['fix the flaky upload test', C.user]],
  [['⏺ ', C.text], ['Reading ', C.text, true], ['src/uploader.ts', C.dim]],
  [['⏺ ', C.green], ['Bash', C.text, true], ['(npm test)', C.dim]],
  [['  ⎿  ', C.dim], ['41 passed, 1 failed', C.dim]],
  [['⏺ ', C.green], ['Update', C.text, true], ['(src/uploader.ts)', C.dim]],
  [['⏺ ', C.text], ['Search', C.text, true], ['("retry")', C.dim]],
  [['  ⎿  ', C.dim], ['12 matches', C.dim]],
  [['⏺ ', C.green], ['Bash', C.text, true], ['(npm run build)', C.dim]],
  [['⏺ ', C.green], ['Update', C.text, true], ['(src/api/orders.ts)', C.dim]],
  [['  ⎿  ', C.dim], ['Added 22 lines', C.dim]],
  [['⏺ ', C.text], ['Reading ', C.text, true], ['package.json', C.dim]],
  [['⏺ ', C.green], ['Bash', C.text, true], ['(npm test)', C.dim]],
  [['  ⎿  ', C.dim], ['42 passed', C.dim]],
]

export function miniTerminal(g: CanvasRenderingContext2D, x: number, y: number, t: number) {
  const shake = Math.sin(t * 61) * 3 * clamp(1 - Math.abs(t - T.gust) * 2.5)
  mini.draw(g, x + shake, y, { rot: deg(-2) })
  g.save()
  g.translate(x + shake, y)
  g.rotate(deg(-2))
  g.beginPath()
  g.rect(-290, -140, 580, 320)
  g.clip()
  const lh = 26
  const scroll = Math.max(0, t - T.session - 0.3) * 7.5 * lh
  const first = Math.floor(scroll / lh)
  for (let i = first; i < first + 14; i++) {
    const segs = SESSION[i % SESSION.length]!
    mono(g, segs, -276, -110 + i * lh - scroll + lh * 1, 1, 17)
  }
  g.restore()
}

// --- the big terminal ---

const TRANSCRIPT: { at: number; segs: Seg[] }[] = [
  { at: -1, segs: [['> ', C.user], ["let's get the uploader ready for beta", C.user]] },
  { at: -1, segs: [] },
  { at: -1, segs: [['⏺ ', C.text], ["I'll wire retries into the uploader first.", C.text]] },
  { at: -1, segs: [] },
  { at: -1, segs: [['⏺ ', C.green], ['Update', C.text, true], ['(src/uploader.ts)', C.dim]] },
  { at: -1, segs: [['  ⎿  ', C.dim], ['Added 14 lines, removed 3 lines', C.dim]] },
  { at: -1, segs: [] },
  { at: T.files - 0.4, segs: [['⏺ ', C.claude], ['board', C.text, true], ['(add · ai · "add retry tests")', C.dim]] },
  { at: T.files - 0.15, segs: [['  ⎿  ', C.dim], ['Added to AI to-do: add retry tests', C.dim]] },
  { at: T.files - 0.15, segs: [] },
  { at: T.ticks - 0.3, segs: [['⏺ ', C.claude], ['board', C.text, true], ['(done · "wire retries into uploader")', C.dim]] },
  { at: T.ticks - 0.1, segs: [['  ⎿  ', C.dim], ['Done: wire retries into uploader', C.dim]] },
  { at: T.ticks - 0.1, segs: [] },
  { at: T.nudge - 0.5, segs: [['⏺ ', C.claude], ['board', C.text, true], ['(add · you · "rotate leaked webhook secret")', C.dim]] },
  { at: T.nudge - 0.3, segs: [['  ⎿  ', C.dim], ['Added to You: rotate leaked webhook secret', C.dim]] },
]

function pane(g: CanvasRenderingContext2D, t: number) {
  const { x0, y0, x1, y1 } = PANE
  // border with the title set into it
  g.strokeStyle = C.border
  g.lineWidth = 1.6
  g.beginPath()
  g.moveTo(x0 + 168, y0)
  g.lineTo(x1 - 8, y0)
  g.arcTo(x1, y0, x1, y0 + 8, 8)
  g.lineTo(x1, y1 - 8)
  g.arcTo(x1, y1, x1 - 8, y1, 8)
  g.lineTo(x0 + 8, y1)
  g.arcTo(x0, y1, x0, y1 - 8, 8)
  g.lineTo(x0, y0 + 8)
  g.arcTo(x0, y0, x0 + 8, y0, 8)
  g.lineTo(x0 + 12, y0)
  g.stroke()
  mono(g, [[' Sticky Board ', C.text, true]], x0 + 10, y0 + 7, 1, 18)

  mono(g, [['shop', C.dim]], PX, rowY(0))
  mono(g, [['×', C.dim]], x1 - 34, rowY(0))
  mono(g, [['phase 2: public beta', C.text]], PX, rowY(1))

  // tabs
  const f = focusAt(t)
  const tabs: [Lane, string][] = [['ai', 'AI'], ['you', 'You'], ['bugs', 'Bugs']]
  let col = 0
  const tabX: Record<string, { x: number; w: number }> = {}
  for (const [lane, name] of tabs) {
    const n = count(lane, t)
    const label = n ? `${name} ${n}` : name
    const x = PX + col * CW
    tabX[lane] = { x, w: label.length * CW }
    // a count that just changed pops
    const changed = Math.max(-99, ...ITEMS.filter(it => it.lane === lane).flatMap(it => [it.born, it.doneAt ?? -99]).filter(c => c > 0 && c <= t))
    const pop = 1 + 0.32 * Math.exp(-(t - changed) * 7) * Math.cos((t - changed) * 18)
    const isFocus = lane === f.lane
    const sinceFocus = prog(t, f.since, 0.2)
    const bright = isFocus ? sinceFocus : lane === f.prev ? 1 - sinceFocus : 0
    g.save()
    g.translate(x + tabX[lane]!.w / 2, rowY(3) - 7)
    g.scale(pop, pop)
    mono(g, [[label, mix(C.dim, C.text, bright), bright > 0.5]], -tabX[lane]!.w / 2, 7)
    g.restore()
    col += label.length + 3
  }
  mono(g, [['─'.repeat(38), C.faint]], PX, rowY(4))

  // the list (old one slides out, new one slides in)
  const swap = prog(t, f.since, 0.4)
  if (swap < 1 && f.prev !== f.lane) listRows(g, f.prev, t, -1, swap)
  listRows(g, f.lane, t, 1, swap)
  return tabX
}

function listRows(g: CanvasRenderingContext2D, lane: Lane, t: number, dir: number, swap: number) {
  const rows = order(lane, t)
  rows.forEach((it, i) => {
    let alpha = 1
    let dx = 0
    if (dir < 0) {
      const k = easeOutCubic(clamp(swap * 2.5))
      alpha = 1 - k
      dx = -28 * k
    } else if (swap < 1) {
      const k = easeOutCubic(clamp((swap - 0.12 - i * 0.09) * 3))
      alpha = k
      dx = 28 * (1 - k)
    }
    if (alpha <= 0) return
    const r = rowOf(it, t)
    const y = rowY(5 + r)
    const isDone = it.doneAt !== undefined && it.doneAt <= t
    const dimK = isDone ? prog(t, it.doneAt!, 0.25) : 0
    const urgent = !isDone && it.pri === 1
    // new items: Claude's are written on by the pencil; yours drop in
    let reveal = 1
    let dy = 0
    if (it.id === 'tests') reveal = prog(t, it.born, 0.55)
    if (it.id === 'secret') {
      // drops in once the row below has made room
      const k = t - it.born - 0.2
      dy = -36 * (1 - spring(k, 2.5, 6))
      alpha *= clamp(k * 6)
    }
    g.save()
    g.globalAlpha = alpha
    const bullet = isDone ? '✓' : urgent ? '!' : '·'
    mono(g, [[bullet, urgent ? C.warn : C.faint, urgent]], PX + dx, y + dy)
    const textColor = mix(C.text, C.faint, dimK)
    const segs: Seg[] = [[it.title, textColor]]
    if (it.area && !isDone) segs.push([` ${it.area}`, C.dim])
    mono(g, segs, PX + 2 * CW + dx, y + dy, reveal)
    g.restore()
  })
}

// Marker annotations and the labels pinned beside the terminal (scene 3).
function annotate(g: CanvasRenderingContext2D, t: number, tabX: Record<string, { x: number; w: number }>) {
  const fade = 1 - prog(t, T.current - 0.7, 0.5)
  if (fade <= 0) return
  const mk = { color: HILITE, w: 5, t, alpha: 0.95 * fade }
  // the phase
  const pp = prog(t, T.phase - 0.05, 0.55)
  if (pp > 0) {
    loop(g, PX + 126, rowY(1) - 7, 152, 26, { ...mk, progress: pp, seed: 31 })
    arrow(g, { x: 1415, y: 104 }, { x: PX + 290, y: rowY(1) - 9 }, 0.12, { ...mk, progress: prog(t, T.phase + 0.2, 0.4), seed: 32 })
  }
  // three lists
  const lp = prog(t, T.three - 0.05, 0.5)
  if (lp > 0) {
    const x0 = tabX.ai!.x - 6
    const x1 = tabX.bugs!.x + tabX.bugs!.w + 6
    underline(g, x0, x1, rowY(3) + 9, { ...mk, progress: lp, seed: 33 })
    arrow(g, { x: 1408, y: 232 }, { x: x1 + 24, y: rowY(3) - 2 }, -0.15, { ...mk, progress: prog(t, T.three + 0.25, 0.4), seed: 34 })
  }
  // circle the list being talked about, in its label's colour
  const marks: [number, Lane, string][] = [[T.listAI, 'ai', '#ffe066'], [T.listYou, 'you', '#8fd0f5'], [T.listBugs, 'bugs', '#a8e39b']]
  marks.forEach(([at, lane, color], i) => {
    const next = marks[i + 1]?.[0] ?? T.current
    const k = prog(t, at - 0.05, 0.45)
    const gone = prog(t, next - 0.1, 0.25)
    if (k <= 0 || gone >= 1) return
    const tb = tabX[lane]!
    loop(g, tb.x + tb.w / 2, rowY(3) - 7, tb.w / 2 + 16, 22, { ...mk, color, progress: k, alpha: (1 - gone) * fade, seed: 40 + i })
    arrow(g, { x: 1400, y: 354 + i * 8 }, { x: 1250, y: rowY(6) - 6 }, 0.18, {
      ...mk, color, progress: prog(t, at + 0.15, 0.4), alpha: (1 - gone) * fade, seed: 50 + i,
    })
  })
}

function drawLabels(g: CanvasRenderingContext2D, t: number) {
  const list: [string, number, number, number][] = [
    ['phase', 1530, 112, -3],
    ['lists', 1540, 222, 2.5],
    ['ai', 1530, 352, -2],
    ['you', 1520, 366, 4],
    ['bugs', 1528, 378, -3.5],
  ]
  list.forEach(([id, x, y, r], i) => {
    const k = prog(t, HITS.labels[i]!, HITS.labelFall)
    if (k <= 0) return
    const land = easeInQuad(k)
    const s = lerp(1.6, 1, land)
    labels[id]!.draw(g, x, y, { rot: deg(r + (1 - land) * 12), scale: s, lift: (1 - land) * 1.2 })
    if (k >= 1) tapes[i]!.draw(g, x - labels[id]!.w / 2 + 8, y - 30, { rot: deg(-40 + i * 7), shadow: 0.35 })
  })
}

export function terminalWorld(g: CanvasRenderingContext2D, t: number) {
  g.save()
  g.translate(TERM.x, TERM.y)
  g.rotate(TERM.rot)
  body.draw(g, TERM.w / 2, TERM.h / 2)
  // corner tape
  tapes[0]!.draw(g, 30, 4, { rot: deg(-38), shadow: 0.3 })
  tapes[1]!.draw(g, TERM.w - 26, 10, { rot: deg(35), shadow: 0.3 })
  tapes[2]!.draw(g, 34, TERM.h - 6, { rot: deg(32), shadow: 0.3 })
  tapes[3]!.draw(g, TERM.w - 30, TERM.h - 8, { rot: deg(-34), shadow: 0.3 })

  // transcript
  const tx = 32
  TRANSCRIPT.forEach((ln, i) => {
    if (ln.at > t || !ln.segs.length) return
    mono(g, ln.segs, tx, 92 + i * LH, ln.at < 0 ? 1 : prog(t, ln.at, 0.28))
  })
  // prompt box
  const by = TERM.h - 116
  g.strokeStyle = C.border
  g.lineWidth = 1.6
  g.beginPath()
  g.roundRect(22, by, 770, 56, 10)
  g.stroke()
  mono(g, [['> ', C.text]], 40, by + 36)
  if (Math.floor(t * 1.6) % 2 === 0) mono(g, [['▌', C.text]], 40 + CW * 2, by + 36)
  mono(g, [['? for shortcuts', C.faint]], 40, TERM.h - 28, 1, 18)

  const tabX = pane(g, t)
  annotate(g, t, tabX)
  drawLabels(g, t)
  claudesPencil(g, t)
  toast(g, t, tabX)
  yourHand(g, t)
  g.restore()
}

// Claude writes its new item, then ticks one off.
function claudesPencil(g: CanvasRenderingContext2D, t: number) {
  const t0 = T.files - 0.55
  const t1 = T.ticks + 1.0
  if (t < t0 || t > t1) return
  const rowTests = rowY(5 + 3)
  const write = prog(t, T.files + 0.05, 0.55)
  const writeEnd = PX + 2 * CW + 'add retry tests'.length * CW * write
  const tickAt = { x: PX + CW / 2, y: rowY(5) - 7 }
  let p: Pt
  let lift = 0.15
  if (t < T.files + 0.05) {
    const k = easeInOutCubic(prog(t, t0, 0.6))
    p = { x: lerp(1500, PX + 2 * CW, k), y: lerp(-260, rowTests - 6, k) }
    lift = lerp(1, 0.15, k)
  } else if (t < T.files + 0.6) {
    p = { x: writeEnd, y: rowTests - 6 + Math.sin(t * 60) * 3 }
  } else if (t < T.ticks) {
    const k = easeInOutCubic(prog(t, T.files + 0.6, T.ticks - T.files - 0.6))
    p = { x: lerp(writeEnd, tickAt.x - 8, k), y: lerp(rowTests - 6, tickAt.y, k) - Math.sin(k * Math.PI) * 40 }
    lift = 0.15 + Math.sin(k * Math.PI) * 0.5
  } else if (t < T.ticks + 0.35) {
    const k = prog(t, T.ticks, 0.32)
    const a = k < 0.35 ? k / 0.35 : 1
    const b2 = k < 0.35 ? 0 : (k - 0.35) / 0.65
    p = { x: tickAt.x - 8 + a * 6 + b2 * 16, y: tickAt.y + a * 8 - b2 * 20 }
  } else {
    const k = easeInQuad(prog(t, T.ticks + 0.35, 0.6))
    p = { x: lerp(tickAt.x + 14, 1550, k), y: lerp(tickAt.y - 12, -300, k) }
    lift = lerp(0.15, 1, k)
  }
  // the tick it draws stays until the row itself shows ✓
  const tk = prog(t, T.ticks, 0.32)
  const wire = ITEMS[0]!
  const fadeTick = 1 - prog(t, wire.doneAt!, 0.2)
  if (tk > 0 && fadeTick > 0) tick(g, tickAt.x + 2, tickAt.y, 26, { color: C.green, w: 4, t, progress: tk, alpha: fadeTick })
  pencil(g, p.x, p.y, -0.95, t, lift, 0.82)
}

function toast(g: CanvasRenderingContext2D, t: number, tabX: Record<string, { x: number; w: number }>) {
  const t0 = T.nudge - 0.08
  if (t < t0) return
  const fly = prog(t, T.lands - 0.18, 0.38)
  if (fly >= 1) return
  const pop = spring(t - t0, 2.6, 6.5)
  const nudge = wobble(t - T.nudge - 0.08, 6.5, 4.5) * 18
  const home = { x: 440, y: 548 }
  const dest = { x: tabX.you!.x + tabX.you!.w / 2, y: rowY(3) - 8 }
  const fk = easeInOutCubic(fly)
  const x = lerp(home.x + nudge, dest.x, fk)
  const y = lerp(home.y, dest.y, fk) - Math.sin(fk * Math.PI) * 120
  const s = lerp(pop * 1.3, 0.2, fk)
  const rot = deg(-2 + nudge * 0.15) + fk * 0.4
  toastSprite.draw(g, x, y, { rot, scale: s, lift: 0.35 + fk * 0.8 })
  g.save()
  g.translate(x, y)
  g.rotate(rot)
  g.scale(s, s)
  // a little bell that rings
  const ring = wobble(t - T.nudge, 7, 4) * 0.6
  g.save()
  g.translate(-236, -2)
  g.rotate(ring)
  ink(g, [{ x: -11, y: 8 }, { x: -9, y: -6 }, { x: 0, y: -14 }, { x: 9, y: -6 }, { x: 11, y: 8 }, { x: -11, y: 8 }], { w: 2.6, t, seed: 900 })
  g.fillStyle = INK
  g.beginPath()
  g.arc(0, 12, 3, 0, TAU)
  g.fill()
  g.restore()
  mono(g, [['For you: ', '#7a5a12', true], ['rotate leaked webhook secret', INK]], -208, 8, 1, 21)
  g.restore()
  // shove lines
  const shove = prog(t, T.nudge, 0.5)
  if (shove > 0 && shove < 1 && fly <= 0) {
    for (let i = 0; i < 3; i++) {
      const yy = home.y - 24 + i * 24
      const len = 40 * (1 - shove)
      ink(g, [{ x: home.x - 300 - len, y: yy }, { x: home.x - 290, y: yy }], { w: 3, t, seed: 910 + i, color: '#f2c94c', alpha: 1 - shove })
    }
  }
}

// You glance, point and click to tick one off.
function yourHand(g: CanvasRenderingContext2D, t: number) {
  const t0 = T.glance - 0.35
  const t1 = T.tick + 1.4
  if (t < t0 || t > t1) return
  const target = { x: PX + 2 * CW + 150, y: rowY(6) - 4 }
  const bullet = { x: PX + CW / 2, y: rowY(6) - 7 }
  let p: Pt
  if (t < T.click - 0.05) {
    const k = easeInOutCubic(prog(t, t0, T.click - 0.05 - t0))
    p = { x: lerp(1480, target.x, k), y: lerp(860, target.y, k) + Math.sin(k * Math.PI) * -30 }
  } else if (t < T.tick + 0.7) {
    p = target
  } else {
    const k = easeInQuad(prog(t, T.tick + 0.7, 0.65))
    p = { x: lerp(target.x, 1500, k), y: lerp(target.y, 900, k) }
  }
  const pressK = prog(t, T.click, 0.18)
  const press = pressK > 0 && pressK < 1 ? Math.sin(pressK * Math.PI) : 0
  clickRings(g, target.x, target.y, prog(t, T.click + 0.02, 0.4), t, '#f2c94c')
  // your tick and a strike through the item
  const copy = ITEMS.find(it => it.id === 'copy')!
  const k = prog(t, T.tick - 0.05, 0.35)
  const fadeK = 1 - prog(t, copy.doneAt!, 0.25)
  if (k > 0 && fadeK > 0) {
    tick(g, bullet.x + 2, bullet.y, 28, { color: C.green, w: 4.5, t, progress: k, alpha: fadeK })
    ink(g, [{ x: PX + 2 * CW - 4, y: rowY(6) - 8 }, { x: PX + 2 * CW + 24 * CW + 4, y: rowY(6) - 6 }], {
      w: 3, color: C.text, t, progress: prog(t, T.tick + 0.05, 0.3), alpha: 0.85 * fadeK, seed: 930,
    })
  }
  confetti(g, target.x, target.y - 10, T.tick + 0.08, t, 77, 30, 0.75)
  hand(g, p.x, p.y, t, press, 0.9)
}

export const termToWorld = (p: Pt) => ({
  x: TERM.x + p.x * Math.cos(TERM.rot) - p.y * Math.sin(TERM.rot),
  y: TERM.y + p.x * Math.sin(TERM.rot) + p.y * Math.cos(TERM.rot),
})

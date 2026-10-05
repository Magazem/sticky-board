// The cork board: everything after the rip lives here and stays pinned, so the
// final wide shot shows the whole story at once.

import { HITS, T } from '../shared/timeline'
import { Pt, clamp, deg, easeInQuad, easeOutBack, easeOutCubic, hash, lerp, prog, rng, wobble } from './core'
import { FONTS, INK, arrow, handText, sparkle } from './ink'
import { PINS, PinColor, Sprite, bake, cutout, drawPin, outline, paperFill, polyPath, scrap, stickyNote, tape } from './paper'
import { TAGS, drawTag } from './tags'
import { TERM, terminalWorld } from './terminal'
import { halftoneTile } from './textures'

// --- the title, as ransom-note letters ---

type Letter = { ch: string; font: string; weight: number; bg: string | 'halftone'; fg: string; size: number; x: number; y: number; rot: number; at: number; sprite?: Sprite }

const STYLE: [string, number, string, string, number][] = [
  // font, weight, paper, ink, size
  ['Anton', 400, '#ffe066', INK, 170],
  ['Abril Fatface', 400, '#26221f', '#fbf7ef', 158],
  ['Bungee', 400, '#f5a3b7', INK, 138],
  ['Playfair Display', 900, '#fbf7ef', '#d8432f', 168],
  ['Rubik Mono One', 400, '#9fd3f2', INK, 128],
  ['Shrikhand', 400, '#b2e3a6', INK, 140],
  ['Alfa Slab One', 400, 'halftone', INK, 146],
  ['Archivo Black', 400, '#e94f37', '#fbf7ef', 140],
  ['Bebas Neue', 400, '#26221f', '#ffe066', 190],
  ['Abril Fatface', 400, '#f9c48c', INK, 162],
  ['Permanent Marker', 400, '#fff3b0', '#1f5fa8', 150],
]

const LETTERS: Letter[] = []

function layoutTitle(g: CanvasRenderingContext2D) {
  const rows: [string, number][] = [['STICKY', 462], ['BOARD', 668]]
  let k = 0
  for (const [word, y] of rows) {
    const boxes = [...word].map(ch => {
      const [font, weight, bg, fg, size] = STYLE[k % STYLE.length]!
      k++
      g.font = `${weight} ${size}px "${font}"`
      const w = g.measureText(ch).width + 44
      return { ch, font, weight, bg, fg, size, w }
    })
    const total = boxes.reduce((n, b) => n + b.w - 6, 0)
    let x = 960 - total / 2
    boxes.forEach((b, i) => {
      const r = rng(k * 31 + i)
      LETTERS.push({
        ch: b.ch, font: b.font, weight: b.weight, bg: b.bg, fg: b.fg, size: b.size,
        x: x + b.w / 2, y: y + (r() - 0.5) * 22, rot: deg((r() - 0.5) * 14), at: HITS.letters[LETTERS.length]!,
      })
      x += b.w - 6
    })
  }
}

function bakeLetters() {
  const probe = document.createElement('canvas').getContext('2d')!
  layoutTitle(probe)
  const dots = halftoneTile(9, '#9a948a', '#f4efe4', 0.36)
  LETTERS.forEach((L, i) => {
    probe.font = `${L.weight} ${L.size}px "${L.font}"`
    const m = probe.measureText(L.ch)
    const gw = m.width
    const asc = m.actualBoundingBoxAscent
    const desc = m.actualBoundingBoxDescent
    const w = gw + 40
    const h = asc + desc + 44
    L.sprite = bake(w, h, g => {
      const pts = scrap(w, h, 500 + i, 0.08)
      const fill = L.bg === 'halftone' ? g.createPattern(dots, 'repeat')! : L.bg
      paperFill(g, pts, fill, { seed: 500 + i, shade: 0.8 })
      g.save()
      g.clip(polyPath(pts))
      g.font = `${L.weight} ${L.size}px "${L.font}"`
      g.fillStyle = L.fg
      g.textBaseline = 'alphabetic'
      g.fillText(L.ch, (w - gw) / 2, 22 + asc)
      g.restore()
    })
  })
}

function drawLetter(g: CanvasRenderingContext2D, L: Letter, t: number) {
  const k = prog(t, L.at - 0.15, 0.15)
  if (k <= 0) return
  const land = easeInQuad(k)
  const settle = wobble(t - L.at, 5, 7)
  // in the finale every letter hops and slaps down again
  const hopT = HITS.hop(LETTERS.indexOf(L))
  const hop = Math.sin(clamp((t - hopT) / 0.24) * Math.PI)
  const s = lerp(1.9, 1, land) + hop * 0.12
  const rot = L.rot + (1 - land) * deg(L.x > 960 ? 22 : -22) + settle * 0.05 + hop * deg(L.x > 960 ? 4 : -4)
  L.sprite!.draw(g, L.x, L.y - hop * 18, { rot, scale: s, lift: (1 - land) * 1.4 + hop * 0.6, alpha: clamp(k * 4) })
}

// --- pinned paper ---

let subtitle: Sprite
let subTapes: Sprite[]
let notes: Sprite[] = []
let sheet: Sprite
let sheetTapes: Sprite[]

const NOTES = [
  { name: 'shop', phase: 'phase 2: public beta', counts: 'AI 3 · You 1 · Bugs 2', color: '#ffe066', x: 2500, y: 560, rot: -4, pin: PINS.red },
  { name: 'blog', phase: 'drafting launch post', counts: 'AI 1 · You 2', color: '#f5a3b7', x: 2955, y: 525, rot: 2.5, pin: PINS.blue },
  { name: 'api', phase: 'v2 migration', counts: 'AI 4 · Bugs 1', color: '#9fd3f2', x: 3410, y: 565, rot: 5, pin: PINS.green },
]

const SHEET = { x: 2955, y: 1235, w: 1220, h: 540 }
const JSON_LINES = [
  '[',
  '  { "project": "/users/you/shop", "lane": "todo",  "title": "add retry tests" },',
  '  { "project": "/users/you/blog", "lane": "human", "title": "pick a hero image" },',
  '  { "project": "/users/you/api",  "lane": "bug",   "title": "token refresh race" },',
  '  …',
  ']',
]
const JSON_SIZE = 23
const JSON_LH = 50

export function bakeWorld() {
  bakeLetters()
  subtitle = cutout(860, 104, '#fbf7ef', 601, { torn: { t: true, b: true }, amp: 4 })
  subTapes = [tape(100, 32, 602), tape(96, 30, 603)]
  notes = NOTES.map((n, i) =>
    stickyNote(340, 340, n.color, 610 + i, g => {
      handText(g, n.name, 30, 86, { size: 64, font: FONTS.marker, weight: 400, jitter: 0, seed: 620 + i })
      handText(g, n.phase, 30, 178, { size: 40, jitter: 0, seed: 630 + i })
      handText(g, n.counts, 30, 262, { size: 36, font: FONTS.hand2, weight: 400, jitter: 0, seed: 640 + i, color: '#5a4a3a' })
    }),
  )
  sheet = bake(SHEET.w, SHEET.h, g => {
    const pts = outline(SHEET.w, SHEET.h, 650, { b: true }, 4)
    paperFill(g, pts, '#fbf6ea', { seed: 650, rim: outline(SHEET.w, SHEET.h, 651, { b: true }, 4, 2.4) })
    g.save()
    g.clip(polyPath(pts))
    g.strokeStyle = 'rgba(220,80,80,0.28)'
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(84, 0)
    g.lineTo(84, SHEET.h)
    g.stroke()
    g.restore()
  })
  sheetTapes = [tape(120, 36, 652), tape(110, 34, 653)]
}

// --- drawing ---

function pinnedTags(g: CanvasRenderingContext2D, t: number) {
  const pinned = TAGS.filter(tag => tag.board)
  pinned.forEach((tag, i) => {
    const b = tag.board!
    const pinAt = T.pins[i]!
    // fly in from the right, hover, then get pinned
    const arrive = easeOutCubic(prog(t, T.tagsBack + i * 0.08, pinAt - T.tagsBack - i * 0.08 - 0.05))
    if (arrive <= 0) return
    const r = hash(i, 5)
    const x = lerp(2300 + i * 200, b.x, arrive)
    const y = lerp(-180 + r * 300, b.y, arrive) + (1 - arrive) * Math.sin(t * 9 + i) * 30
    const hover = t < pinAt ? 0.7 + Math.sin(t * 11 + i) * 0.1 : 0
    const jolt = wobble(t - pinAt, 6, 8)
    const rot = b.rot + (1 - arrive) * 2.4 * (i % 2 ? 1 : -1) + jolt * 0.06
    const sx = t < pinAt ? Math.cos((1 - arrive) * 9) : 1
    drawTag(g, tag, x, y, t, { rot, s: b.s, sx, lift: hover })
    const pin = [PINS.red, PINS.yellow, PINS.blue][i]!
    const drop = 1 - easeInQuad(prog(t, pinAt - 0.12, 0.12))
    if (t >= pinAt - 0.12) {
      const hx = tag.hole.x * b.s
      const hy = tag.hole.y * b.s
      const c = Math.cos(b.rot)
      const s = Math.sin(b.rot)
      drawPin(g, b.x + hx * c - hy * s, b.y + hx * s + hy * c, pin, drop * 1.4, 1.05)
    }
  })
}

function meet(g: CanvasRenderingContext2D, t: number) {
  const k = prog(t, T.sticky - 0.42, 0.4)
  if (k <= 0) return
  handText(g, 'meet…', 330, 330, { size: 74, color: '#fbf7ef', t, progress: k, rot: deg(-10), seed: 670 })
  arrow(g, { x: 430, y: 350 }, { x: 520, y: 420 }, -0.3, { w: 5, color: '#fbf7ef', t, progress: prog(t, T.sticky - 0.1, 0.3), seed: 671 })
}

function subtitleStrip(g: CanvasRenderingContext2D, t: number) {
  const k = easeOutBack(prog(t, T.subtitle - 0.3, 0.35), 1.4)
  if (k <= 0) return
  const x = 960
  const y = 862
  const rot = deg(-1.5)
  subtitle.draw(g, x, y, { rot, sx: k, lift: (1 - k) * 0.6 })
  if (k > 0.9) {
    subTapes[0]!.draw(g, x - 430, y - 28, { rot: deg(-50), shadow: 0.35 })
    subTapes[1]!.draw(g, x + 432, y - 30, { rot: deg(48), shadow: 0.35 })
  }
  g.save()
  g.translate(x, y)
  g.rotate(rot)
  handText(g, 'a tiny pane inside Claude Code', 0, 22, {
    size: 68, align: 'center', t, progress: prog(t, T.subtitle, 1.35), seed: 680,
  })
  g.restore()
}

function projectNotes(g: CanvasRenderingContext2D, t: number) {
  NOTES.forEach((n, i) => {
    const at = T.projects[i]!
    const k = prog(t, at - 0.2, 0.2)
    if (k <= 0) return
    const land = easeInQuad(k)
    const jolt = wobble(t - at, 5, 7)
    notes[i]!.draw(g, n.x, n.y + (1 - land) * 80, {
      rot: deg(n.rot + (1 - land) * 14 + jolt * 2),
      scale: lerp(1.5, 1, land),
      lift: (1 - land) * 1.3 + 0.08,
    })
    drawPin(g, n.x, n.y - 150, n.pin as PinColor, 1.4 * (1 - easeInQuad(prog(t, at - 0.02, 0.1))), 1.15)
  })
}

function jsonSheet(g: CanvasRenderingContext2D, t: number) {
  const k = prog(t, T.file - 0.32, 0.42)
  if (k <= 0) return
  const land = easeOutBack(k, 1.1)
  const x = SHEET.x
  const y = lerp(SHEET.y + 900, SHEET.y, land)
  const rot = deg(-1)
  sheet.draw(g, x, y, { rot, lift: (1 - k) * 0.8 })
  if (k >= 1) {
    sheetTapes[0]!.draw(g, x - SHEET.w / 2 + 40, y - SHEET.h / 2 + 6, { rot: deg(-35), shadow: 0.3 })
    sheetTapes[1]!.draw(g, x + SHEET.w / 2 - 40, y - SHEET.h / 2 + 4, { rot: deg(32), shadow: 0.3 })
  }
  g.save()
  g.translate(x - SHEET.w / 2, y - SHEET.h / 2)
  g.rotate(rot)
  const typed = prog(t, T.file + 0.05, 1.1)
  g.font = `400 34px "${FONTS.type}"`
  g.fillStyle = INK
  g.fillText('~/.sticky/notes.json', 110, 80)
  const highlight = ['#ffe066', '#f5a3b7', '#9fd3f2']
  JSON_LINES.forEach((line, i) => {
    const ly = 150 + i * JSON_LH
    const lineK = clamp(typed * JSON_LINES.length - i)
    if (lineK <= 0) return
    if (i >= 1 && i <= 3) {
      const hk = easeOutCubic(prog(t, T.file + 0.45 + i * 0.16, 0.3))
      if (hk > 0) {
        g.fillStyle = highlight[i - 1]!
        g.globalAlpha = 0.6
        g.fillRect(104, ly - 30, 1060 * hk, 40)
        g.globalAlpha = 1
      }
    }
    g.font = `400 ${JSON_SIZE}px "${FONTS.type}"`
    g.fillStyle = INK
    g.fillText(line.slice(0, Math.ceil(line.length * lineK)), 110, ly)
  })
  g.restore()
  // arrows from each project's note to its line
  NOTES.forEach((n, i) => {
    const ak = prog(t, T.file + 0.3 + i * 0.16, 0.45)
    if (ak <= 0) return
    const ly = SHEET.y - SHEET.h / 2 + 150 + (i + 1) * JSON_LH - 12
    const from = { x: n.x - 40 + i * 30, y: n.y + 190 }
    const to = { x: SHEET.x - SHEET.w / 2 + 70 + i * 0, y: ly + 0 }
    arrow(g, from, { x: to.x + 330 + i * 120, y: ly - 26 }, 0.12 * (i - 1), { w: 5, color: '#fbf7ef', t, progress: ak, seed: 690 + i })
  })
}

// A little twinkle once the whole title has landed.
function titleSparkles(g: CanvasRenderingContext2D, t: number) {
  const at = HITS.letters[HITS.letters.length - 1]! + 0.15
  const spots: [number, number, number][] = [[548, 380, 30], [1395, 372, 24], [1352, 770, 28], [585, 742, 20], [1440, 560, 18]]
  spots.forEach(([x, y, r], i) => {
    const k = prog(t, at + i * 0.06, 0.3)
    if (k > 0) sparkle(g, x, y, r, { t, progress: k, color: '#fff3b0', w: 4, seed: 980 + i })
  })
}

// Small extras that make the wide shot feel lived-in.
function extras(g: CanvasRenderingContext2D, t: number) {
  const k = prog(t, T.file + 1.6, 0.4)
  if (k <= 0) return
  // the two lost tags from the opening, found and pinned in the corner
  const spots = [
    { tag: TAGS[3]!, x: 2280, y: 1840, rot: deg(-6) },
    { tag: TAGS[4]!, x: 2700, y: 1880, rot: deg(5) },
  ]
  spots.forEach((s, i) => {
    drawTag(g, s.tag, s.x, s.y, t, { rot: s.rot, s: 0.9, appear: k })
    drawPin(g, s.x + (i ? -80 : 80), s.y - 40, i ? PINS.white : PINS.yellow, 0, 1)
  })
}

export function corkWorld(g: CanvasRenderingContext2D, t: number, view: { x0: number; y0: number; x1: number; y1: number }) {
  const sees = (x0: number, y0: number, x1: number, y1: number) => x1 > view.x0 && x0 < view.x1 && y1 > view.y0 && y0 < view.y1
  if (sees(TERM.x - 100, TERM.y - 100, TERM.x + TERM.w + 400, TERM.y + TERM.h + 100)) terminalWorld(g, t)
  if (sees(2000, 300, 3800, 2100)) {
    extras(g, t)
    jsonSheet(g, t)
    projectNotes(g, t)
  }
  if (sees(0, -200, 1920, 1000)) {
    subtitleStrip(g, t)
    for (const L of LETTERS) drawLetter(g, L, t)
    meet(g, t)
    titleSparkles(g, t)
  }
  pinnedTags(g, t)
}

export const finaleSparkles = (g: CanvasRenderingContext2D, t: number, pts: Pt[]) =>
  pts.forEach((p, i) => sparkle(g, p.x, p.y, 22, { t, progress: prog(t, T.final + i * 0.08, 0.35), color: '#fbf7ef', w: 4, seed: 990 + i }))


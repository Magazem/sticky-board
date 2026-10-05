// Ink: hand-drawn strokes that boil, handwriting that writes itself on, and the
// doodles (bug, key, snail, moon, arrows, loops, ticks) that live on the paper.

import { Pt, TAU, boilOf, clamp, easeInOutSine, easeOutCubic, hash, lerp, noise1, pathLength, resample, sampleBezier } from './core'

export const INK = '#2a2420'
export const MARKER_RED = '#d8432f'
export const HILITE = '#ffd84a'

export const FONTS = {
  hand: 'Caveat',
  hand2: 'Gochi Hand',
  marker: 'Permanent Marker',
  kalam: 'Kalam',
  mono: 'JetBrains Mono',
  type: 'Special Elite',
}

export type InkOpts = {
  w?: number
  color?: string
  seed?: number
  t?: number // film time, for boiling
  jitter?: number
  progress?: number
  taper?: number // 0 = blunt marker, 1 = pen
  alpha?: number
  blend?: GlobalCompositeOperation
}

// Splits one progress value across `n` strokes drawn one after another.
export const part = (p: number, i: number, n: number) => clamp(p * n - i)

export function ink(g: CanvasRenderingContext2D, pts: Pt[], o: InkOpts = {}) {
  const progress = o.progress ?? 1
  if (progress <= 0 || pts.length < 2) return
  const w = o.w ?? 3
  const seed = o.seed ?? 1
  const boil = boilOf(o.t ?? 0)
  const jit = o.jitter ?? 1.1
  const taper = o.taper ?? 0.35
  const step = Math.max(1.5, w * 0.7)
  const full = resample(pts, step)
  const fullTotal = full.length - 1
  let p = full
  const L = (p.length - 1) * progress
  const n = Math.floor(L)
  const frac = L - n
  const cut = p.slice(0, n + 1)
  if (n + 1 < p.length && frac > 0) {
    const a = p[n]!
    const c = p[n + 1]!
    cut.push({ x: lerp(a.x, c.x, frac), y: lerp(a.y, c.y, frac) })
  }
  p = cut
  if (p.length < 2) return
  // boil: a smooth wobble along the stroke that changes each boil frame
  const q = p.map((pt, i) => ({
    x: pt.x + noise1(i * 0.06 + boil * 5.3, seed * 3 + boil) * jit,
    y: pt.y + noise1(i * 0.06 + boil * 4.1, seed * 3 + 77 + boil) * jit,
  }))
  const total = q.length - 1
  const left: Pt[] = []
  const right: Pt[] = []
  for (let i = 0; i <= total; i++) {
    const a = q[Math.max(0, i - 1)]!
    const c = q[Math.min(total, i + 1)]!
    let dx = c.x - a.x
    let dy = c.y - a.y
    const len = Math.hypot(dx, dy) || 1
    dx /= len
    dy /= len
    const ends = Math.min(1, (i + 1) / 5, (fullTotal - i + 1) / 5)
    const pressure = 0.82 + 0.3 * noise1(i * 0.045, seed + 9)
    const half = (w / 2) * pressure * lerp(1, Math.sqrt(Math.max(0.05, ends)), taper)
    left.push({ x: q[i]!.x - dy * half, y: q[i]!.y + dx * half })
    right.push({ x: q[i]!.x + dy * half, y: q[i]!.y - dx * half })
  }
  g.save()
  g.globalAlpha = o.alpha ?? 0.94
  if (o.blend) g.globalCompositeOperation = o.blend
  g.fillStyle = o.color ?? INK
  g.beginPath()
  g.moveTo(left[0]!.x, left[0]!.y)
  for (const pt of left) g.lineTo(pt.x, pt.y)
  for (let i = right.length - 1; i >= 0; i--) g.lineTo(right[i]!.x, right[i]!.y)
  g.closePath()
  g.fill()
  // round caps
  const cap = (pt: Pt, r: number) => {
    g.beginPath()
    g.arc(pt.x, pt.y, r, 0, TAU)
    g.fill()
  }
  const capR = (w / 2) * lerp(0.95, 0.35, taper)
  cap(q[0]!, capR)
  cap(q[q.length - 1]!, capR)
  g.restore()
}

export function line(g: CanvasRenderingContext2D, a: Pt, c: Pt, o: InkOpts = {}) {
  ink(g, [a, c], o)
}

export function curve(g: CanvasRenderingContext2D, a: Pt, c: Pt, bend: number, o: InkOpts = {}) {
  const mx = (a.x + c.x) / 2
  const my = (a.y + c.y) / 2
  const dx = c.x - a.x
  const dy = c.y - a.y
  const ctrl = { x: mx - dy * bend, y: my + dx * bend }
  const pts = sampleBezier(a, { x: lerp(a.x, ctrl.x, 0.66), y: lerp(a.y, ctrl.y, 0.66) }, { x: lerp(c.x, ctrl.x, 0.66), y: lerp(c.y, ctrl.y, 0.66) }, c, 30)
  ink(g, pts, o)
  return pts
}

export function arrow(g: CanvasRenderingContext2D, a: Pt, c: Pt, bend: number, o: InkOpts & { head?: number } = {}) {
  const p = o.progress ?? 1
  const pts = curve(g, a, c, bend, { ...o, progress: part(p, 0, 1.25) * 1 })
  const hp = clamp((p - 0.8) / 0.2)
  if (hp <= 0) return
  const end = pts[pts.length - 1]!
  const prev = pts[pts.length - 4]!
  const ang = Math.atan2(end.y - prev.y, end.x - prev.x)
  const hl = o.head ?? 22
  for (const side of [-1, 1]) {
    const tip = { x: end.x - Math.cos(ang + side * 0.5) * hl, y: end.y - Math.sin(ang + side * 0.5) * hl }
    ink(g, [tip, end], { ...o, progress: hp, seed: (o.seed ?? 1) + side * 7 })
  }
}

// A marker loop around something, overshooting where it closes.
export function loop(g: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, o: InkOpts & { turns?: number; tilt?: number } = {}) {
  const seed = o.seed ?? 3
  const turns = o.turns ?? 1.18
  const a0 = -2.2 + hash(seed) * 0.6
  const pts: Pt[] = []
  const n = 90
  for (let i = 0; i <= n; i++) {
    const k = i / n
    const a = a0 + k * turns * TAU
    const wob = 1 + noise1(k * 4, seed) * 0.05 + k * 0.06
    const x = Math.cos(a) * rx * wob
    const y = Math.sin(a) * ry * wob
    const tilt = o.tilt ?? -0.05
    pts.push({ x: cx + x * Math.cos(tilt) - y * Math.sin(tilt), y: cy + x * Math.sin(tilt) + y * Math.cos(tilt) })
  }
  ink(g, pts, { taper: 0.6, ...o })
}

export function tick(g: CanvasRenderingContext2D, x: number, y: number, s: number, o: InkOpts = {}) {
  const p = o.progress ?? 1
  ink(g, [{ x: x - s * 0.5, y: y - s * 0.05 }, { x: x - s * 0.12, y: y + s * 0.38 }], { ...o, progress: part(p, 0, 2.2) })
  ink(
    g,
    [
      { x: x - s * 0.12, y: y + s * 0.38 },
      { x: x + s * 0.18, y: y - s * 0.12 },
      { x: x + s * 0.55, y: y - s * 0.55 },
    ],
    { ...o, progress: clamp((p * 2.2 - 1) / 1.2), seed: (o.seed ?? 1) + 5 },
  )
}

export function underline(g: CanvasRenderingContext2D, x0: number, x1: number, y: number, o: InkOpts = {}) {
  const pts: Pt[] = []
  for (let i = 0; i <= 20; i++) {
    const k = i / 20
    pts.push({ x: lerp(x0, x1, k), y: y + Math.sin(k * 5 + (o.seed ?? 0)) * 2 + k * 3 })
  }
  ink(g, pts, { taper: 0.7, ...o })
}

// Handwriting that writes itself on, letter by letter.
export type TextOpts = {
  font?: string
  size?: number
  weight?: number | string
  color?: string
  progress?: number
  seed?: number
  t?: number
  align?: 'left' | 'center' | 'right'
  jitter?: number
  alpha?: number
  rot?: number
  letterSpacing?: number
}

export function handText(g: CanvasRenderingContext2D, text: string, x: number, y: number, o: TextOpts = {}) {
  const size = o.size ?? 40
  g.save()
  g.font = `${o.weight ?? 700} ${size}px "${o.font ?? FONTS.hand}"`
  g.textBaseline = 'alphabetic'
  const spacing = o.letterSpacing ?? 0
  const xs: number[] = []
  for (let i = 0; i <= text.length; i++) xs.push(g.measureText(text.slice(0, i)).width + spacing * i)
  const width = xs[text.length]!
  const x0 = o.align === 'center' ? -width / 2 : o.align === 'right' ? -width : 0
  const progress = o.progress ?? 1
  const shown = progress * text.length
  const boil = boilOf(o.t ?? 0)
  const seed = o.seed ?? 1
  const jit = o.jitter ?? 1
  g.translate(x, y)
  if (o.rot) g.rotate(o.rot)
  g.fillStyle = o.color ?? INK
  g.globalAlpha = o.alpha ?? 1
  for (let i = 0; i < text.length; i++) {
    if (i >= shown) break
    const ch = text[i]!
    if (ch === ' ') continue
    const cw = xs[i + 1]! - xs[i]!
    const jx = (hash(seed, i, boil) - 0.5) * 0.9 * jit
    const jy = (hash(seed, i, boil, 2) - 0.5) * 1.6 * jit + (hash(seed, i) - 0.5) * size * 0.05
    const jr = (hash(seed, i, 3) - 0.5) * 0.08 * jit
    const frac = clamp(shown - i)
    g.save()
    g.translate(x0 + xs[i]! + jx + cw / 2, jy)
    g.rotate(jr)
    if (frac < 1) {
      g.beginPath()
      g.rect(-cw / 2 - 2, -size * 1.2, (cw + 4) * frac, size * 1.7)
      g.clip()
    }
    g.fillText(ch, -cw / 2, 0)
    g.restore()
  }
  g.restore()
  return width
}

export function measure(g: CanvasRenderingContext2D, text: string, size: number, font = FONTS.hand, weight: number | string = 700) {
  g.save()
  g.font = `${weight} ${size}px "${font}"`
  const w = g.measureText(text).width
  g.restore()
  return w
}

// --- doodles (local coordinates around 0,0; s = size scale) ---

export function bug(g: CanvasRenderingContext2D, x: number, y: number, s: number, o: InkOpts & { walk?: number } = {}) {
  const p = o.progress ?? 1
  const walk = o.walk ?? 0
  const base = { w: 3.2 * s, color: o.color ?? INK, t: o.t, seed: o.seed ?? 21, jitter: 0.9 * s }
  g.save()
  g.translate(x, y)
  // body
  const body: Pt[] = []
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * TAU - Math.PI / 2
    body.push({ x: Math.cos(a) * 26 * s, y: Math.sin(a) * 34 * s + 6 * s })
  }
  ink(g, body, { ...base, progress: part(p, 0, 5) })
  // shell split and head
  ink(g, [{ x: 0, y: -26 * s }, { x: 0, y: 38 * s }], { ...base, w: 2.4 * s, progress: part(p, 1, 5) })
  const head: Pt[] = []
  for (let i = 0; i <= 30; i++) {
    const a = (i / 30) * TAU
    head.push({ x: Math.cos(a) * 13 * s, y: -34 * s + Math.sin(a) * 10 * s })
  }
  ink(g, head, { ...base, progress: part(p, 2, 5) })
  // spots
  if (part(p, 3, 5) > 0) {
    g.fillStyle = o.color ?? INK
    g.globalAlpha = part(p, 3, 5)
    for (const [sx, sy, r] of [[-12, -2, 6], [13, 4, 7], [-11, 22, 5], [12, 24, 4.5]] as const) {
      g.beginPath()
      g.ellipse(sx * s, sy * s, r * s, r * s * 0.9, 0, 0, TAU)
      g.fill()
    }
    g.globalAlpha = 1
  }
  // legs and antennae wiggle as it walks
  const lp = part(p, 4, 5)
  for (let i = 0; i < 3; i++) {
    for (const side of [-1, 1]) {
      const ph = Math.sin(walk * 14 + i * 2.1 + (side > 0 ? Math.PI : 0)) * 0.35
      const ay = (-10 + i * 18) * s
      const kx = side * (40 + i * 2) * s
      const ky = ay + (i - 1) * 10 * s + ph * 14 * s
      ink(g, [{ x: side * 24 * s, y: ay }, { x: kx * 0.75, y: ay - 6 * s + ph * 6 * s }, { x: kx, y: ky }], {
        ...base,
        w: 2.6 * s,
        progress: lp,
        seed: 40 + i * 2 + side,
      })
    }
  }
  for (const side of [-1, 1]) {
    const sway = Math.sin(walk * 9 + side) * 4 * s
    ink(g, [{ x: side * 5 * s, y: -42 * s }, { x: side * 12 * s + sway, y: -56 * s }, { x: side * 22 * s + sway, y: -62 * s }], {
      ...base,
      w: 2.2 * s,
      progress: lp,
      seed: 60 + side,
    })
  }
  g.restore()
}

export function key(g: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number, o: InkOpts = {}) {
  const p = o.progress ?? 1
  const base = { w: 4 * s, color: o.color ?? INK, t: o.t, seed: o.seed ?? 31, jitter: 0.8 * s }
  g.save()
  g.translate(x, y)
  g.rotate(rot)
  const bow: Pt[] = []
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * TAU + 0.4
    bow.push({ x: -40 * s + Math.cos(a) * 24 * s, y: Math.sin(a) * 24 * s })
  }
  ink(g, bow, { ...base, progress: part(p, 0, 4) })
  const hole: Pt[] = []
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * TAU
    hole.push({ x: -44 * s + Math.cos(a) * 8 * s, y: Math.sin(a) * 8 * s })
  }
  ink(g, hole, { ...base, w: 3 * s, progress: part(p, 1, 4) })
  ink(g, [{ x: -16 * s, y: 0 }, { x: 56 * s, y: 0 }], { ...base, progress: part(p, 2, 4) })
  ink(g, [{ x: 30 * s, y: 0 }, { x: 30 * s, y: 16 * s }, { x: 40 * s, y: 16 * s }, { x: 40 * s, y: 4 * s }], { ...base, w: 3.4 * s, progress: part(p, 3, 4) })
  ink(g, [{ x: 48 * s, y: 0 }, { x: 48 * s, y: 12 * s }, { x: 56 * s, y: 12 * s }], { ...base, w: 3.4 * s, progress: part(p, 3, 4), seed: 39 })
  g.restore()
}

export function snail(g: CanvasRenderingContext2D, x: number, y: number, s: number, o: InkOpts & { crawl?: number } = {}) {
  const p = o.progress ?? 1
  const crawl = o.crawl ?? 0
  const base = { w: 3 * s, color: o.color ?? INK, t: o.t, seed: o.seed ?? 51, jitter: 0.7 * s }
  const stretch = 1 + Math.sin(crawl * 6) * 0.06
  g.save()
  g.translate(x, y)
  // shell spiral
  const spiral: Pt[] = []
  for (let i = 0; i <= 70; i++) {
    const k = i / 70
    const a = k * TAU * 2.4
    const r = (30 - k * 26) * s
    spiral.push({ x: Math.cos(a) * r, y: -24 * s + Math.sin(a) * r })
  }
  ink(g, spiral, { ...base, progress: part(p, 0, 3) })
  // foot
  ink(
    g,
    [
      { x: -34 * s, y: 4 * s },
      { x: 0, y: 6 * s },
      { x: 44 * s * stretch, y: 4 * s },
      { x: 58 * s * stretch, y: -6 * s },
      { x: 56 * s * stretch, y: -22 * s },
      { x: 46 * s * stretch, y: -16 * s },
      { x: 36 * s * stretch, y: -4 * s },
    ],
    { ...base, progress: part(p, 1, 3) },
  )
  // eye stalks
  const bob = Math.sin(crawl * 5) * 3 * s
  for (const [dx, h] of [[0, 30], [8, 24]] as const) {
    const top = { x: (54 + dx) * s * stretch, y: (-22 - h) * s + bob }
    ink(g, [{ x: 54 * s * stretch, y: -20 * s }, top], { ...base, w: 2.4 * s, progress: part(p, 2, 3), seed: 55 + dx })
    if (part(p, 2, 3) >= 1) {
      g.fillStyle = o.color ?? INK
      g.beginPath()
      g.arc(top.x, top.y, 4 * s, 0, TAU)
      g.fill()
    }
  }
  g.restore()
}

export function moon(g: CanvasRenderingContext2D, x: number, y: number, r: number, o: InkOpts = {}) {
  // A crescent opening to the right: the outer circle's left side, then the
  // inner circle's left side back again (tips where the two circles meet).
  const d = 0.5 * r
  const r2 = 0.85 * r
  const ix = (d * d + r * r - r2 * r2) / (2 * d)
  const iy = Math.sqrt(r * r - ix * ix)
  const a1 = Math.atan2(iy, ix)
  const b1 = Math.atan2(iy, ix - d)
  const pts: Pt[] = []
  for (let i = 0; i <= 36; i++) {
    const a = lerp(a1, TAU - a1, i / 36)
    pts.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r })
  }
  for (let i = 0; i <= 28; i++) {
    const a = lerp(TAU - b1, b1, i / 28)
    pts.push({ x: x + d + Math.cos(a) * r2, y: y + Math.sin(a) * r2 })
  }
  ink(g, pts, { w: 3, taper: 0.4, ...o })
}

export function sparkle(g: CanvasRenderingContext2D, x: number, y: number, r: number, o: InkOpts = {}) {
  const p = o.progress ?? 1
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + 0.2
    ink(g, [{ x: x + Math.cos(a) * r * 0.35, y: y + Math.sin(a) * r * 0.35 }, { x: x + Math.cos(a) * r, y: y + Math.sin(a) * r }], {
      w: 3,
      taper: 0.8,
      ...o,
      progress: part(p, i, 4),
      seed: (o.seed ?? 7) + i,
    })
  }
}

// Little motion marks either side of something that just moved.
export function motionLines(g: CanvasRenderingContext2D, x: number, y: number, r: number, k: number, o: InkOpts = {}) {
  if (k <= 0 || k >= 1) return
  const grow = easeOutCubic(clamp(k * 2))
  const fade = 1 - clamp((k - 0.5) * 2)
  for (let i = 0; i < 3; i++) {
    const a = -0.5 + i * 0.5
    const r0 = r * (1 + 0.1 * grow)
    const r1 = r * (1 + 0.5 * grow)
    for (const side of [-1, 1]) {
      const ang = side > 0 ? a : Math.PI - a
      ink(g, [{ x: x + Math.cos(ang) * r0, y: y + Math.sin(ang) * r0 }, { x: x + Math.cos(ang) * r1, y: y + Math.sin(ang) * r1 }], {
        w: 3,
        taper: 0.8,
        alpha: 0.9 * fade,
        ...o,
        seed: (o.seed ?? 5) + i * 3 + side,
      })
    }
  }
}

// A curl of wind: a wavy line that rolls up into a spiral, drawn on and then
// wiped away from its tail.
export function windCurl(g: CanvasRenderingContext2D, x: number, y: number, len: number, k: number, o: InkOpts = {}) {
  const pts: Pt[] = []
  const straight = len * 0.78
  const R = Math.min(34, len * 0.07)
  for (let i = 0; i <= 50; i++) {
    const u = i / 50
    pts.push({ x: x + u * straight, y: y + Math.sin(u * TAU + (o.seed ?? 0)) * 9 * (1 - u * 0.5) })
  }
  const cx = x + straight
  const cy = y - R
  for (let i = 1; i <= 34; i++) {
    const u = i / 34
    const a = Math.PI / 2 - u * Math.PI * 1.65
    const r = R * (1 - u * 0.55)
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r })
  }
  const head = easeOutCubic(clamp(k * 1.7))
  const tail = easeInOutSine(clamp((k - 0.4) * 1.67))
  const from = Math.floor(tail * (pts.length - 2))
  const to = Math.max(from + 2, Math.ceil(head * pts.length))
  if (tail < 1) ink(g, pts.slice(from, to), { w: 3.5, taper: 0.9, ...o })
}

export const pathLen = pathLength

// Paper cut-outs: torn and scissor-cut shapes baked into sprites with a paper
// grain and two shadows (resting and lifted), plus tape, pushpins and sticky notes.

import { Pt, clamp, fbm1, hash, lerp, rng } from './core'
import { TEX_SCALE, canvas, ctx2d, grainTile } from './textures'

let grain: HTMLCanvasElement | null = null

export function initPaper() {
  grain = grainTile(512, 11)
}

function grainFill(g: CanvasRenderingContext2D, seed: number) {
  const p = g.createPattern(grain!, 'repeat')!
  const r = rng(seed)
  p.setTransform(new DOMMatrix().translate(r() * 512, r() * 512).scale(1 / TEX_SCALE))
  return p
}

export function polyPath(pts: Pt[]) {
  const p = new Path2D()
  pts.forEach((q, i) => (i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y)))
  p.closePath()
  return p
}

type Edges = { t?: boolean; r?: boolean; b?: boolean; l?: boolean }

// Walks the rectangle's outline; torn sides wander and fray, cut sides stay
// nearly straight with slightly-off corners, like scissors in a hurry.
export function outline(w: number, h: number, seed: number, torn: Edges = {}, amp = 4.5, grow = 0): Pt[] {
  const r = rng(seed)
  const cj = 3.2
  const corners: Pt[] = [
    { x: -grow + (r() - 0.5) * cj, y: -grow + (r() - 0.5) * cj },
    { x: w + grow + (r() - 0.5) * cj, y: -grow + (r() - 0.5) * cj },
    { x: w + grow + (r() - 0.5) * cj, y: h + grow + (r() - 0.5) * cj },
    { x: -grow + (r() - 0.5) * cj, y: h + grow + (r() - 0.5) * cj },
  ]
  const sides: (boolean | undefined)[] = [torn.t, torn.r, torn.b, torn.l]
  const out: Pt[] = []
  for (let s = 0; s < 4; s++) {
    const a = corners[s]!
    const c = corners[(s + 1) % 4]!
    const len = Math.hypot(c.x - a.x, c.y - a.y)
    const nx = (c.y - a.y) / len
    const ny = -(c.x - a.x) / len
    const isTorn = sides[s]
    const steps = isTorn ? Math.max(4, Math.round(len / 2.6)) : Math.max(2, Math.round(len / 60))
    for (let i = 0; i < steps; i++) {
      const k = i / steps
      let off = 0
      if (isTorn) {
        const edgeFade = Math.min(1, k * 8, (1 - k) * 8)
        off = (fbm1(k * len * 0.045, seed + s * 13, 3) * amp + (r() - 0.5) * amp * 0.55) * edgeFade
        off += amp * 0.25
      } else if (i > 0) off = (r() - 0.5) * 1.1
      out.push({ x: lerp(a.x, c.x, k) + nx * off, y: lerp(a.y, c.y, k) + ny * off })
    }
  }
  return out
}

// An irregular many-sided scrap around a w×h box (for ransom letters, labels).
export function scrap(w: number, h: number, seed: number, wild = 0.12): Pt[] {
  const r = rng(seed)
  const n = 5 + Math.floor(r() * 3)
  const pts: Pt[] = []
  const cx = w / 2
  const cy = h / 2
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.5 - Math.PI * 0.75
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    // project onto the box, then push out a little
    const sx = Math.abs(ca) > 1e-6 ? cx / Math.abs(ca) : 1e9
    const sy = Math.abs(sa) > 1e-6 ? cy / Math.abs(sa) : 1e9
    const d = Math.min(sx, sy) * (1 + wild * (0.4 + r()))
    pts.push({ x: cx + ca * d, y: cy + sa * d })
  }
  return pts
}

export type PaperOpts = { seed: number; rim?: Pt[]; rimColor?: string; shade?: number; grainAlpha?: number }

// Fill a shape as paper: optional torn white rim, the colour, grain, a soft light.
export function paperFill(g: CanvasRenderingContext2D, pts: Pt[], color: string | CanvasPattern, o: PaperOpts) {
  const bb = bbox(pts)
  if (o.rim) {
    const rim = polyPath(o.rim)
    g.fillStyle = o.rimColor ?? '#f7f2e7'
    g.fill(rim)
    g.save()
    g.clip(rim)
    g.globalCompositeOperation = 'multiply'
    g.fillStyle = grainFill(g, o.seed + 5)
    g.fillRect(bb.x - 20, bb.y - 20, bb.w + 40, bb.h + 40)
    g.restore()
  }
  const path = polyPath(pts)
  g.fillStyle = color
  g.fill(path)
  g.save()
  g.clip(path)
  g.globalCompositeOperation = 'multiply'
  g.globalAlpha = o.grainAlpha ?? 1
  g.fillStyle = grainFill(g, o.seed)
  g.fillRect(bb.x - 20, bb.y - 20, bb.w + 40, bb.h + 40)
  g.globalAlpha = 1
  const shade = o.shade ?? 1
  if (shade > 0) {
    const lg = g.createLinearGradient(bb.x, bb.y, bb.x + bb.w, bb.y + bb.h)
    lg.addColorStop(0, `rgba(255,255,255,${0.1 * shade})`)
    lg.addColorStop(0.55, 'rgba(255,255,255,0)')
    lg.addColorStop(1, `rgba(60,40,20,${0.12 * shade})`)
    g.globalCompositeOperation = 'source-over'
    g.fillStyle = lg
    g.fillRect(bb.x, bb.y, bb.w, bb.h)
  }
  g.restore()
}

export function bbox(pts: Pt[]) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of pts) {
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x)
    y1 = Math.max(y1, p.y)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

export type DrawOpts = {
  rot?: number
  scale?: number
  sx?: number
  sy?: number
  lift?: number // 0 resting flat, 1 held well above the surface
  alpha?: number
  shadow?: number
}

export class Sprite {
  constructor(
    readonly img: HTMLCanvasElement,
    readonly tight: HTMLCanvasElement,
    readonly soft: HTMLCanvasElement,
    readonly w: number,
    readonly h: number,
    readonly pad: number,
  ) {}

  // Draws centred on (x, y); the shadow falls down-right and spreads as it lifts.
  draw(g: CanvasRenderingContext2D, x: number, y: number, o: DrawOpts = {}) {
    const rot = o.rot ?? 0
    const s = o.scale ?? 1
    const sx = s * (o.sx ?? 1)
    const sy = s * (o.sy ?? 1)
    const lift = clamp(o.lift ?? 0, 0, 2)
    const alpha = o.alpha ?? 1
    const fw = this.w + this.pad * 2
    const fh = this.h + this.pad * 2
    if (alpha <= 0) return
    const shadow = (o.shadow ?? 1) * alpha
    if (shadow > 0) {
      const ox = (3 + lift * 16) * s
      const oy = (5 + lift * 24) * s
      g.save()
      g.translate(x + ox, y + oy)
      g.rotate(rot)
      g.scale(sx * (1 + lift * 0.05), sy * (1 + lift * 0.05))
      g.globalCompositeOperation = 'multiply'
      const k = clamp(lift)
      g.globalAlpha = shadow * 0.5 * (1 - k) * (1 - lift * 0.15)
      g.drawImage(this.tight, -fw / 2, -fh / 2, fw, fh)
      g.globalAlpha = shadow * (0.18 + 0.32 * k) * (1 - lift * 0.15)
      g.drawImage(this.soft, -fw / 2, -fh / 2, fw, fh)
      g.restore()
    }
    g.save()
    g.translate(x, y)
    g.rotate(rot)
    g.scale(sx, sy)
    g.globalAlpha = alpha
    g.drawImage(this.img, -fw / 2, -fh / 2, fw, fh)
    g.restore()
  }
}

// Bake a cut-out: `paint` draws in local coordinates 0..w × 0..h.
export function bake(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void, pad = 30, scale = TEX_SCALE) {
  const fw = (w + pad * 2) * scale
  const fh = (h + pad * 2) * scale
  const img = canvas(fw, fh)
  const g = ctx2d(img)
  g.scale(scale, scale)
  g.translate(pad, pad)
  paint(g)

  const sil = canvas(fw, fh)
  const sg = ctx2d(sil)
  sg.drawImage(img, 0, 0)
  sg.globalCompositeOperation = 'source-in'
  sg.fillStyle = 'rgb(58,36,18)'
  sg.fillRect(0, 0, fw, fh)

  const blurred = (px: number) => {
    const c = canvas(fw, fh)
    const cg = ctx2d(c)
    cg.filter = `blur(${px * scale}px)`
    cg.drawImage(sil, 0, 0)
    return c
  }
  return new Sprite(img, blurred(2.2), blurred(11), w, h, pad)
}

// A cut-out with the usual treatment: optional torn sides with a white core.
export function cutout(
  w: number,
  h: number,
  color: string | ((g: CanvasRenderingContext2D) => string | CanvasPattern),
  seed: number,
  opts: { torn?: Edges; amp?: number; content?: (g: CanvasRenderingContext2D) => void; shade?: number } = {},
) {
  return bake(w, h, g => {
    const torn = opts.torn ?? {}
    const amp = opts.amp ?? 4.5
    const anyTorn = torn.t || torn.r || torn.b || torn.l
    const body = outline(w, h, seed, torn, amp)
    const rim = anyTorn ? outline(w, h, seed + 1, torn, amp * 0.9, 2.6) : undefined
    paperFill(g, body, typeof color === 'string' ? color : color(g), { seed, rim, shade: opts.shade })
    if (opts.content) {
      g.save()
      g.clip(polyPath(body))
      opts.content(g)
      g.restore()
    }
  })
}

// Masking tape: translucent, with zig-zag torn ends.
export function tape(w: number, h: number, seed: number, tint = '232,220,186') {
  return bake(
    w,
    h,
    g => {
      const r = rng(seed)
      const pts: Pt[] = []
      const teeth = Math.max(3, Math.round(h / 4))
      pts.push({ x: 0, y: 0 })
      pts.push({ x: w, y: (r() - 0.5) * 1.5 })
      for (let i = 1; i <= teeth; i++) pts.push({ x: w + (i % 2 ? 3.5 + r() * 2 : -1 - r() * 2), y: (h * i) / teeth })
      pts.push({ x: 0, y: h + (r() - 0.5) * 1.5 })
      for (let i = teeth - 1; i >= 1; i--) pts.push({ x: i % 2 ? -3.5 - r() * 2 : 1 + r() * 2, y: (h * i) / teeth })
      const path = polyPath(pts)
      g.fillStyle = `rgba(${tint},0.78)`
      g.fill(path)
      g.save()
      g.clip(path)
      g.globalCompositeOperation = 'multiply'
      g.globalAlpha = 0.6
      g.fillStyle = grainFill(g, seed)
      g.fillRect(-10, -10, w + 20, h + 20)
      g.globalAlpha = 1
      g.globalCompositeOperation = 'source-over'
      g.strokeStyle = 'rgba(255,255,255,0.18)'
      g.lineWidth = 0.8
      for (let y = 3; y < h; y += 3 + r() * 3) {
        g.beginPath()
        g.moveTo(0, y)
        g.lineTo(w, y + (r() - 0.5) * 2)
        g.stroke()
      }
      const lg = g.createLinearGradient(0, 0, 0, h)
      lg.addColorStop(0, 'rgba(255,255,255,0.22)')
      lg.addColorStop(0.5, 'rgba(255,255,255,0)')
      lg.addColorStop(1, 'rgba(90,70,40,0.1)')
      g.fillStyle = lg
      g.fillRect(-6, 0, w + 12, h)
      g.restore()
    },
    12,
  )
}

// A sticky note: adhesive band at the top, the bottom edge curling up.
export function stickyNote(w: number, h: number, color: string, seed: number, content?: (g: CanvasRenderingContext2D) => void) {
  return bake(w, h, g => {
    const pts = outline(w, h, seed, {}, 0)
    paperFill(g, pts, color, { seed, shade: 0.6, grainAlpha: 0.7 })
    g.save()
    g.clip(polyPath(pts))
    const top = g.createLinearGradient(0, 0, 0, h * 0.22)
    top.addColorStop(0, 'rgba(120,90,0,0.10)')
    top.addColorStop(1, 'rgba(120,90,0,0)')
    g.fillStyle = top
    g.fillRect(0, 0, w, h * 0.22)
    const curl = g.createLinearGradient(0, h * 0.78, 0, h)
    curl.addColorStop(0, 'rgba(255,255,255,0)')
    curl.addColorStop(0.75, 'rgba(255,255,255,0.16)')
    curl.addColorStop(1, 'rgba(80,60,0,0.16)')
    g.fillStyle = curl
    g.fillRect(0, h * 0.78, w, h * 0.22)
    if (content) content(g)
    g.restore()
  })
}

export type PinColor = { head: string; dark: string; light: string }
export const PINS: Record<string, PinColor> = {
  red: { head: '#e0473c', dark: '#8f1f19', light: '#ffb3a6' },
  blue: { head: '#3d7fd9', dark: '#1c3f80', light: '#b6d6ff' },
  green: { head: '#3fae6a', dark: '#1d5e36', light: '#b9f0cc' },
  yellow: { head: '#f2c230', dark: '#8a6500', light: '#fff0a8' },
  white: { head: '#efe9df', dark: '#9c958a', light: '#ffffff' },
}

// A pushpin seen from slightly above. `drop` 1 = hovering high, 0 = pushed in.
export function drawPin(g: CanvasRenderingContext2D, x: number, y: number, c: PinColor, drop = 0, s = 1) {
  const lift = clamp(drop, 0, 1.5)
  g.save()
  g.translate(x, y)
  g.scale(s, s)
  // shadow: the needle's long thin shadow and the head's blob
  g.save()
  g.globalCompositeOperation = 'multiply'
  g.fillStyle = `rgba(50,28,10,${0.35 - lift * 0.15})`
  g.beginPath()
  g.ellipse(9 + lift * 30, 12 + lift * 40, 15 + lift * 6, 9 + lift * 4, 0.5, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = `rgba(50,28,10,${0.3 - lift * 0.15})`
  g.lineWidth = 2
  g.beginPath()
  g.moveTo(2, 2)
  g.lineTo(14 + lift * 30, 16 + lift * 40)
  g.stroke()
  g.restore()

  const up = lift * 34
  g.translate(-lift * 6, -up)
  const k = 1 + lift * 0.35
  g.scale(k, k)
  // body (the short cylinder under the head)
  g.fillStyle = c.dark
  g.beginPath()
  g.ellipse(0, 4, 9, 5, 0, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = c.head
  g.fillRect(-9, -6, 18, 10)
  g.fillStyle = c.dark
  g.globalAlpha = 0.35
  g.fillRect(3, -6, 6, 10)
  g.globalAlpha = 1
  // head
  const rg = g.createRadialGradient(-5, -14, 2, 0, -9, 17)
  rg.addColorStop(0, c.light)
  rg.addColorStop(0.35, c.head)
  rg.addColorStop(1, c.dark)
  g.fillStyle = rg
  g.beginPath()
  g.ellipse(0, -9, 16, 12, 0, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = 'rgba(255,255,255,0.75)'
  g.beginPath()
  g.ellipse(-6, -14, 5, 2.6, -0.4, 0, Math.PI * 2)
  g.fill()
  g.restore()
}

// Seeded per-object stop-motion jitter: tiny offsets that change on each boil.
export function jitter(id: number, boil: number, amount = 0.7) {
  return {
    x: (hash(id, boil, 1) - 0.5) * amount,
    y: (hash(id, boil, 2) - 0.5) * amount,
    r: (hash(id, boil, 3) - 0.5) * amount * 0.004,
  }
}

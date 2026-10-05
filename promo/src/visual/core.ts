// Math, seeded randomness and easing. Everything in the film is a pure function
// of time and a seed, so any frame can be rendered alone and in any order.

export type Pt = { x: number; y: number }

export const TAU = Math.PI * 2
export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const prog = (t: number, t0: number, dur: number) => clamp((t - t0) / dur)
export const deg = (d: number) => (d * Math.PI) / 180

export const smooth = (x: number) => x * x * (3 - 2 * x)
export const easeOutCubic = (x: number) => 1 - (1 - x) ** 3
export const easeInCubic = (x: number) => x ** 3
export const easeInQuad = (x: number) => x * x
export const easeOutQuad = (x: number) => 1 - (1 - x) ** 2
export const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2)
export const easeInOutSine = (x: number) => -(Math.cos(Math.PI * x) - 1) / 2
export const easeOutBack = (x: number, s = 1.70158) => 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2
export const easeInBack = (x: number, s = 1.70158) => (s + 1) * x ** 3 - s * x * x

// A damped spring settling from 0 to 1, t in seconds since release.
export function spring(t: number, freq = 3.2, damp = 7) {
  if (t <= 0) return 0
  return 1 - Math.exp(-damp * t) * Math.cos(TAU * freq * t)
}

// A decaying wobble around 0 (for things that were just hit).
export function wobble(t: number, freq = 5, damp = 6) {
  if (t <= 0) return 0
  return Math.exp(-damp * t) * Math.sin(TAU * freq * t)
}

export function rng(seed: number) {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hash(...ns: number[]) {
  let h = 0x811c9dc5
  for (const n of ns) {
    h ^= Math.floor(n * 7919) | 0
    h = Math.imul(h, 0x01000193)
    h ^= h >>> 13
    h = Math.imul(h, 0x5bd1e995)
    h ^= h >>> 15
  }
  return (h >>> 0) / 4294967296
}

export const strSeed = (s: string) => {
  let h = 7
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  return Math.abs(h) % 100000
}

// Smooth value noise in [-1, 1].
export function noise1(x: number, seed = 0) {
  const i = Math.floor(x)
  const f = x - i
  const a = hash(i, seed) * 2 - 1
  const c = hash(i + 1, seed) * 2 - 1
  return lerp(a, c, smooth(f))
}

export function fbm1(x: number, seed = 0, octaves = 3) {
  let sum = 0
  let amp = 0.5
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    sum += noise1(x * 2 ** o, seed + o * 17) * amp
    norm += amp
    amp *= 0.5
  }
  return sum / norm
}

export function noise2(x: number, y: number, seed = 0) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = smooth(x - ix)
  const fy = smooth(y - iy)
  const a = hash(ix, iy, seed)
  const b = hash(ix + 1, iy, seed)
  const c = hash(ix, iy + 1, seed)
  const d = hash(ix + 1, iy + 1, seed)
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy) * 2 - 1
}

// Boiling: hand-drawn lines re-jitter a few times a second, like redrawn frames.
export const BOIL_FPS = 8
let boilClock: number | null = null
// Sub-frames of one motion-blurred frame share the frame's boil.
export const holdBoil = (t: number | null) => {
  boilClock = t
}
export const boilOf = (t: number) => Math.floor((boilClock ?? t) * BOIL_FPS)

// A keyframed value: [time, value, easing to reach it].
export type Key = [number, number, ((x: number) => number)?]
export function track(keys: Key[], t: number) {
  if (t <= keys[0]![0]) return keys[0]![1]
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, ease] = keys[i]!
    const [t0, v0] = keys[i - 1]!
    if (t <= t1) return lerp(v0, v1, (ease ?? easeInOutCubic)((t - t0) / (t1 - t0)))
  }
  return keys[keys.length - 1]![1]
}

export const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y)

export function bezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  }
}

export function sampleBezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n = 40) {
  return Array.from({ length: n + 1 }, (_, i) => bezier(p0, p1, p2, p3, i / n))
}

// Even spacing along a polyline.
export function resample(pts: Pt[], step: number) {
  if (pts.length < 2) return pts.slice()
  const out: Pt[] = [pts[0]!]
  let carry = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!
    const c = pts[i]!
    const seg = dist(a, c)
    let d = step - carry
    while (d <= seg) {
      const k = d / seg
      out.push({ x: lerp(a.x, c.x, k), y: lerp(a.y, c.y, k) })
      d += step
    }
    carry = seg - (d - step)
  }
  const last = pts[pts.length - 1]!
  if (dist(out[out.length - 1]!, last) > step * 0.3) out.push(last)
  return out
}

export function pathLength(pts: Pt[]) {
  let L = 0
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1]!, pts[i]!)
  return L
}

export const mix = (c1: string, c2: string, k: number) => {
  const a = parseHex(c1)
  const b = parseHex(c2)
  return `rgb(${Math.round(lerp(a[0], b[0], k))},${Math.round(lerp(a[1], b[1], k))},${Math.round(lerp(a[2], b[2], k))})`
}

export function parseHex(c: string): [number, number, number] {
  const h = c.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

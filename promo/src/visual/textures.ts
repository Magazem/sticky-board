// Procedural materials: paper, cork, paper grain, halftone and film grain.
// All tile seamlessly, so the world can be as large as the camera needs.

import { hash, lerp, rng, smooth } from './core'

export const TEX_SCALE = 2 // texture pixels per world pixel

export function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.ceil(w))
  c.height = Math.max(1, Math.ceil(h))
  return c
}

export const ctx2d = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: false })!

// Tileable value noise: the lattice wraps every `period` cells.
function tnoise(x: number, y: number, period: number, seed: number) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = smooth(x - ix)
  const fy = smooth(y - iy)
  const w = (n: number) => ((n % period) + period) % period
  const a = hash(w(ix), w(iy), seed)
  const b = hash(w(ix + 1), w(iy), seed)
  const c = hash(w(ix), w(iy + 1), seed)
  const d = hash(w(ix + 1), w(iy + 1), seed)
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy) * 2 - 1
}

function tfbm(u: number, v: number, cells: number, octaves: number, seed: number) {
  let sum = 0
  let amp = 0.5
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    const p = cells * 2 ** o
    sum += tnoise(u * p, v * p, p, seed + o * 31) * amp
    norm += amp
    amp *= 0.5
  }
  return sum / norm
}

function fibers(g: CanvasRenderingContext2D, size: number, count: number, seed: number, light: string, dark: string) {
  const r = rng(seed)
  g.lineCap = 'round'
  for (let i = 0; i < count; i++) {
    const x = r() * size
    const y = r() * size
    const len = 6 + r() * 26
    const a = r() * Math.PI * 2
    const bend = (r() - 0.5) * 10
    g.strokeStyle = r() < 0.55 ? light : dark
    g.globalAlpha = 0.05 + r() * 0.08
    g.lineWidth = 0.6 + r() * 1.2
    for (const [ox, oy] of [[0, 0], [-size, 0], [size, 0], [0, -size], [0, size]]) {
      g.beginPath()
      g.moveTo(x + ox, y + oy)
      g.quadraticCurveTo(
        x + ox + Math.cos(a) * len * 0.5 - Math.sin(a) * bend,
        y + oy + Math.sin(a) * len * 0.5 + Math.cos(a) * bend,
        x + ox + Math.cos(a) * len,
        y + oy + Math.sin(a) * len,
      )
      g.stroke()
    }
  }
  g.globalAlpha = 1
}

// Background paper sheet (cream), one tile of `world` world pixels.
export function paperTile(world: number, base: [number, number, number], seed: number) {
  const size = world * TEX_SCALE
  const c = canvas(size, size)
  const g = ctx2d(c)
  const img = g.createImageData(size, size)
  const d = img.data
  const r = rng(seed)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size
      const blotch = tfbm(u, v, 3, 3, seed) * 0.035
      const mid = tfbm(u, v, 48, 2, seed + 7) * 0.018
      const fine = (r() - 0.5) * 0.045
      const k = 1 + blotch + mid + fine
      const i = (y * size + x) * 4
      d[i] = base[0] * k
      d[i + 1] = base[1] * k
      d[i + 2] = base[2] * (k - blotch * 0.4)
      d[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  fibers(g, size, 2600, seed + 3, '#ffffff', '#7a6448')
  return c
}

// Cork: a mosaic of granules with dark pores, at two scales.
export function corkTile(world: number, seed: number) {
  const size = world * TEX_SCALE
  const c = canvas(size, size)
  const g = ctx2d(c)
  const img = g.createImageData(size, size)
  const d = img.data
  const r = rng(seed)

  const layer = (cell: number, s: number) => {
    const n = Math.round(size / cell)
    const step = size / n
    const pts = new Float32Array(n * n * 3)
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const k = (j * n + i) * 3
        pts[k] = (i + hash(i, j, s)) * step
        pts[k + 1] = (j + hash(j, i, s + 1)) * step
        pts[k + 2] = hash(i, j, s + 2)
      }
    return { n, step, pts }
  }
  const fine = layer(5 * TEX_SCALE, seed)
  const coarse = layer(13 * TEX_SCALE, seed + 50)

  const sample = (L: ReturnType<typeof layer>, x: number, y: number) => {
    const ci = Math.floor(x / L.step)
    const cj = Math.floor(y / L.step)
    let f1 = 1e9
    let f2 = 1e9
    let tone = 0
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        const ii = ci + di
        const jj = cj + dj
        const wi = ((ii % L.n) + L.n) % L.n
        const wj = ((jj % L.n) + L.n) % L.n
        const k = (wj * L.n + wi) * 3
        // points are stored for the wrapped cell; shift them by whole tiles
        const sx = L.pts[k]! + (ii - wi) * L.step
        const sy = L.pts[k + 1]! + (jj - wj) * L.step
        const dd = (sx - x) ** 2 + (sy - y) ** 2
        if (dd < f1) {
          f2 = f1
          f1 = dd
          tone = L.pts[k + 2]!
        } else if (dd < f2) f2 = dd
      }
    return { edge: Math.sqrt(f2) - Math.sqrt(f1), tone }
  }

  const dark = [104, 66, 34]
  const mid = [186, 136, 84]
  const light = [228, 186, 130]
  const warpAmp = 6 * TEX_SCALE
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size
      // domain warp breaks up the cell grid so granules read as pressed crumbs
      const wx = x + tfbm(u, v, 24, 2, seed + 21) * warpAmp
      const wy = y + tfbm(u, v, 24, 2, seed + 22) * warpAmp
      const a = sample(fine, wx, wy)
      const b2 = sample(coarse, wx, wy)
      const low = tfbm(u, v, 4, 3, seed + 9)
      let t = 0.35 + a.tone * 0.35 + b2.tone * 0.25 + low * 0.18
      const edgeK = Math.min(1, a.edge / (2.2 * TEX_SCALE))
      const crease = Math.min(1, b2.edge / (2.6 * TEX_SCALE))
      t *= 0.55 + 0.45 * edgeK
      t *= 0.8 + 0.2 * crease
      t += (r() - 0.5) * 0.12
      t = Math.max(0, Math.min(1.05, t))
      const lo = t < 0.5 ? dark : mid
      const hi = t < 0.5 ? mid : light
      const k = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5
      const i = (y * size + x) * 4
      d[i] = lerp(lo[0]!, hi[0]!, k)
      d[i + 1] = lerp(lo[1]!, hi[1]!, k)
      d[i + 2] = lerp(lo[2]!, hi[2]!, k)
      d[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  // a few deep pores
  for (let i = 0; i < size * size * 0.00012; i++) {
    const x = r() * size
    const y = r() * size
    const rad = (0.6 + r() * 1.6) * TEX_SCALE
    g.fillStyle = `rgba(50,28,12,${0.35 + r() * 0.35})`
    g.beginPath()
    g.ellipse(x, y, rad * (1 + r()), rad, r() * 3, 0, Math.PI * 2)
    g.fill()
  }
  return c
}

// Grayscale paper grain for multiplying onto cut-outs.
export function grainTile(size: number, seed: number, strength = 1) {
  const c = canvas(size, size)
  const g = ctx2d(c)
  const img = g.createImageData(size, size)
  const d = img.data
  const r = rng(seed)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size
      const k =
        236 +
        strength * (tfbm(u, v, 6, 3, seed) * 14 + tfbm(u, v, 40, 2, seed + 3) * 8 + (r() - 0.5) * 16)
      const i = (y * size + x) * 4
      d[i] = d[i + 1] = d[i + 2] = Math.min(255, k + 12)
      d[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  fibers(g, size, 900, seed + 1, '#ffffff', '#6d5a46')
  return c
}

// Screen-space film grain: a few frames that cycle.
export function filmGrain(w: number, h: number, seed: number) {
  const c = canvas(w, h)
  const g = ctx2d(c)
  const img = g.createImageData(w, h)
  const d = img.data
  const r = rng(seed)
  for (let i = 0; i < w * h; i++) {
    const v = 128 + (r() + r() + r() - 1.5) * 90
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v
    d[i * 4 + 3] = 255
  }
  g.putImageData(img, 0, 0)
  return c
}

// Newsprint halftone dots.
export function halftoneTile(cell: number, ink: string, paper: string, radius = 0.32) {
  const c = canvas(cell * 2, cell * 2)
  const g = ctx2d(c)
  g.fillStyle = paper
  g.fillRect(0, 0, c.width, c.height)
  g.fillStyle = ink
  for (const [x, y] of [[0, 0], [cell, cell], [cell * 2, 0], [0, cell * 2], [cell * 2, cell * 2]]) {
    g.beginPath()
    g.arc(x, y, cell * radius, 0, Math.PI * 2)
    g.fill()
  }
  return c
}

// Stripes, for a cut-out of patterned wrapping paper.
export function stripeTile(size: number, a: string, b2: string) {
  const c = canvas(size, size)
  const g = ctx2d(c)
  g.fillStyle = a
  g.fillRect(0, 0, size, size)
  g.fillStyle = b2
  g.fillRect(0, 0, size / 2, size)
  return c
}

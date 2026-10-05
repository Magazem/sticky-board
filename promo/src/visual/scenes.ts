// The film: two worlds (a paper desk, then a cork board) joined by a paper rip,
// each with its own camera, finished with an end card, grain and vignette.

import { FPS, H, T, W } from '../shared/timeline'
import { Key, Pt, boilOf, clamp, deg, holdBoil, easeInQuad, easeOutBack, easeOutQuad, hash, lerp, noise1, prog, rng, track } from './core'
import { bakeDesk, deskCamera, drawDesk } from './desk'
import { FONTS, handText, sparkle } from './ink'
import { PINS, Sprite, cutout, drawPin, tape } from './paper'
import { bakeTags } from './tags'
import { bakeTerminal } from './terminal'
import { TEX_SCALE, canvas, corkTile, ctx2d, filmGrain, paperTile } from './textures'
import { bakeWorld, corkWorld } from './world'

type Mips = { canvas: HTMLCanvasElement; scale: number }[]
let paperBG: Mips
let corkBG: Mips
let grains: HTMLCanvasElement[] = []
let vignette: HTMLCanvasElement
let deskBuffer: HTMLCanvasElement
let tagline: Sprite
let urlStrip: Sprite
let endTapes: Sprite[]

export function initScenes() {
  smoothing(document.querySelector('canvas')!.getContext('2d')!)
  paperBG = mips(paperTile(1024, [242, 233, 214], 5))
  corkBG = mips(corkTile(1024, 9))
  grains = [0, 1, 2, 3].map(i => filmGrain(W / 2, H / 2, 40 + i))
  vignette = canvas(W, H)
  const vg = ctx2d(vignette)
  const rg = vg.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 1.02)
  rg.addColorStop(0, 'rgba(255,255,255,1)')
  rg.addColorStop(1, 'rgba(150,120,95,1)')
  vg.fillStyle = rg
  vg.fillRect(0, 0, W, H)
  deskBuffer = canvas(W, H)
  smoothing(ctx2d(deskBuffer))
  bakeTags()
  bakeDesk()
  bakeTerminal()
  bakeWorld()
  tagline = cutout(1300, 124, '#fbf7ef', 950, { torn: { t: true, b: true }, amp: 5 })
  urlStrip = cutout(1040, 76, '#ffe066', 951, {})
  endTapes = [tape(110, 34, 952), tape(104, 32, 953), tape(96, 30, 954)]
}

// Pre-shrunk copies of a tile, so a zoomed-out camera samples a smooth texture
// instead of shimmering as it drifts.
function mips(tile: HTMLCanvasElement): Mips {
  const out: Mips = [{ canvas: tile, scale: TEX_SCALE }]
  let src = tile
  for (const scale of [1, 0.5]) {
    const c = canvas(src.width / 2, src.height / 2)
    const g = ctx2d(c)
    g.imageSmoothingQuality = 'high'
    g.drawImage(src, 0, 0, c.width, c.height)
    out.push({ canvas: c, scale })
    src = c
  }
  return out
}

const smoothing = (g: CanvasRenderingContext2D) => {
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'
}

type Cam = { x: number; y: number; z: number; rot: number }

const CORK_KEYS: [number, number, number, number][] = [
  [T.rip, 980, 360, 1.18],
  [T.pins[0]! - 0.1, 960, 300, 1.28],
  [T.pins[2]! + 0.12, 960, 300, 1.3],
  [T.sticky - 0.12, 960, 545, 1.0],
  [T.toTerminal, 960, 556, 1.03],
  [T.toTerminal + 1.05, 965, 1665, 1.0],
  [T.phase - 0.75, 972, 1660, 1.0],
  [T.phase - 0.02, 1500, 1520, 1.55],
  [T.listBugs + 1.1, 1508, 1528, 1.6],
  [T.current + 0.45, 980, 1650, 1.04],
  [T.nudge - 0.35, 992, 1648, 1.06],
  [T.nudge + 0.3, 1150, 1612, 1.2],
  [T.glance - 0.45, 1176, 1604, 1.22],
  [T.glance + 0.35, 1380, 1604, 1.62],
  [T.tick + 0.75, 1392, 1600, 1.66],
  [T.projects[0]! - 0.05, 2955, 690, 1.0],
  [T.file - 0.3, 2955, 700, 1.0],
  [T.file + 0.55, 2955, 930, 0.82],
  [T.outro - 0.95, 2962, 945, 0.84],
  [T.outro - 0.05, 960, 520, 1.0],
  [T.keep, 960, 530, 1.02],
  [T.endCard - 0.15, 1890, 1100, 0.5],
  [T.end, 1890, 1090, 0.47],
]

function corkCamera(t: number): Cam {
  const x = track(CORK_KEYS.map(k => [k[0], k[1]] as Key), t)
  const y = track(CORK_KEYS.map(k => [k[0], k[2]] as Key), t)
  const z = track(CORK_KEYS.map(k => [k[0], k[3]] as Key), t)
  return { x, y, z, rot: deg(noise1(t * 0.22, 9) * 0.5) }
}

// Handheld drift plus a kick whenever something is slammed down.
function handheld(t: number) {
  const hits = [...T.pins, T.sticky, T.board, ...T.projects, T.final]
  let kick = 0
  for (const h of hits) {
    const d = t - h
    if (d > 0 && d < 0.5) kick += Math.exp(-d * 11) * Math.sin(d * 70) * 5
  }
  return {
    x: noise1(t * 0.35, 1) * 4 + kick,
    y: noise1(t * 0.31, 2) * 3 + kick * 0.6,
  }
}

function applyCam(g: CanvasRenderingContext2D, cam: Cam, t: number) {
  const hh = handheld(t)
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.translate(W / 2 + hh.x, H / 2 + hh.y)
  g.rotate(cam.rot)
  g.scale(cam.z, cam.z)
  g.translate(-cam.x, -cam.y)
}

function viewOf(cam: Cam) {
  const hw = W / 2 / cam.z + 80
  const hh = H / 2 / cam.z + 80
  return { x0: cam.x - hw, y0: cam.y - hh, x1: cam.x + hw, y1: cam.y + hh }
}

function background(g: CanvasRenderingContext2D, levels: Mips, cam: Cam) {
  // the smallest level that still has at least one texel per screen pixel
  const level = levels.slice().reverse().find(l => l.scale >= cam.z * 0.95) ?? levels[0]!
  const p = g.createPattern(level.canvas, 'repeat')!
  p.setTransform(new DOMMatrix().scale(1 / level.scale))
  g.fillStyle = p
  const v = viewOf(cam)
  g.fillRect(v.x0 - 200, v.y0 - 200, v.x1 - v.x0 + 400, v.y1 - v.y0 + 400)
}

function deskFrame(g: CanvasRenderingContext2D, t: number) {
  const cam = deskCamera(t)
  applyCam(g, cam, t)
  background(g, paperBG, cam)
  drawDesk(g, t)
}

function corkFrame(g: CanvasRenderingContext2D, t: number) {
  const cam = corkCamera(t)
  applyCam(g, cam, t)
  background(g, corkBG, cam)
  corkWorld(g, t, viewOf(cam))
}

// The desk paper tears in two and is pulled away, revealing the cork beneath.
const RIP = 0.66
const TEAR: Pt[] = (() => {
  const r = rng(77)
  const pts: Pt[] = []
  for (let x = -80; x <= W + 80; x += 7) pts.push({ x, y: 545 + noise1(x * 0.006, 3) * 60 + noise1(x * 0.05, 4) * 9 + (r() - 0.5) * 7 })
  return pts
})()

function rip(g: CanvasRenderingContext2D, t: number) {
  const k = prog(t, T.rip, RIP)
  const dg = ctx2d(deskBuffer)
  dg.save()
  deskFrame(dg, t)
  dg.restore()
  const pivot = { x: W + 60, y: 560 }
  const open = easeOutQuad(clamp(k * 1.5))
  const away = easeInQuad(clamp((k - 0.18) / 0.82))
  for (const side of [-1, 1]) {
    const edge = side < 0 ? TEAR : TEAR.slice().reverse()
    const poly = side < 0
      ? [{ x: -200, y: -400 }, ...edge, { x: W + 200, y: -400 }]
      : [{ x: W + 200, y: H + 400 }, ...edge, { x: -200, y: H + 400 }]
    const rim = edge.map((p, i) => ({ x: p.x, y: p.y - side * (4 + hash(i, side) * 8 + noise1(i * 0.3, side) * 3) }))
    const rimPoly = side < 0
      ? [{ x: -200, y: -400 }, ...rim, { x: W + 200, y: -400 }]
      : [{ x: W + 200, y: H + 400 }, ...rim, { x: -200, y: H + 400 }]
    g.save()
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.translate(pivot.x, pivot.y + side * away * 1100)
    g.rotate(-side * deg(24) * open)
    g.translate(-pivot.x, -pivot.y)
    // shadow and the white torn core
    g.save()
    g.shadowColor = 'rgba(40,20,5,0.45)'
    g.shadowBlur = 30
    g.shadowOffsetY = 12
    g.fillStyle = '#f7f1e3'
    g.beginPath()
    rimPoly.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)))
    g.closePath()
    g.fill()
    g.restore()
    g.beginPath()
    poly.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)))
    g.closePath()
    g.clip()
    g.drawImage(deskBuffer, 0, 0)
    g.restore()
  }
}

function endCard(g: CanvasRenderingContext2D, t: number) {
  g.setTransform(1, 0, 0, 1, 0, 0)
  const k1 = easeOutBack(prog(t, T.keep + 0.05, 0.45), 1.3)
  if (k1 > 0) {
    const y = lerp(1300, 872, k1)
    tagline.draw(g, 960, y, { rot: deg(-1.2), lift: (1 - k1) * 0.8 + 0.1 })
    g.save()
    g.translate(960, y)
    g.rotate(deg(-1.2))
    handText(g, 'keep your loose ends where you can see them', 0, 24, {
      size: 72, align: 'center', t, progress: prog(t, T.keep + 0.15, 1.55), seed: 960,
    })
    g.restore()
    const pinK = prog(t, T.final - 0.1, 0.1)
    if (pinK > 0) {
      drawPin(g, 330, y - 34, PINS.red, 1.4 * (1 - easeInQuad(pinK)), 1.2)
      drawPin(g, 1600, y - 40, PINS.yellow, 1.4 * (1 - easeInQuad(prog(t, T.final - 0.04, 0.1))), 1.2)
    }
  }
  const k2 = prog(t, T.endCard, 0.18)
  if (k2 > 0) {
    const land = easeInQuad(k2)
    const y = 982
    urlStrip.draw(g, 960, y, { rot: deg(1), scale: lerp(1.6, 1, land), lift: (1 - land) * 1.3 + 0.1 })
    g.save()
    g.translate(960, y)
    g.rotate(deg(1))
    g.scale(lerp(1.6, 1, land), lerp(1.6, 1, land))
    g.font = `400 34px "${FONTS.type}"`
    g.fillStyle = '#2a2420'
    g.textAlign = 'center'
    g.fillText('a Claude Code mod  ·  github.com/Magazem/sticky-board', 0, 12)
    g.restore()
    if (k2 >= 1) {
      endTapes[0]!.draw(g, 960 - 520, y - 18, { rot: deg(-48), shadow: 0.4 })
      endTapes[1]!.draw(g, 960 + 522, y - 14, { rot: deg(44), shadow: 0.4 })
    }
  }
  const sp: Pt[] = [{ x: 250, y: 800 }, { x: 1690, y: 790 }, { x: 1530, y: 1035 }, { x: 380, y: 1030 }]
  sp.forEach((p, i) =>
    sparkle(g, p.x, p.y, 26, { t, progress: prog(t, T.final + i * 0.07, 0.3), color: '#fff3b0', w: 4.5, seed: 970 + i }),
  )
}

function post(g: CanvasRenderingContext2D, t: number) {
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.globalCompositeOperation = 'multiply'
  g.drawImage(vignette, 0, 0)
  g.globalCompositeOperation = 'overlay'
  g.globalAlpha = 0.06
  g.drawImage(grains[boilOf(t) % grains.length]!, 0, 0, W, H)
  // a faint exposure flicker, like stop-motion frames shot one by one
  g.globalCompositeOperation = 'source-over'
  const flicker = (hash(boilOf(t), 5) - 0.5) * 0.025
  g.globalAlpha = Math.abs(flicker)
  g.fillStyle = flicker > 0 ? '#fff4e0' : '#1e140c'
  g.fillRect(0, 0, W, H)
  g.globalAlpha = 1
  // fade in and out
  const dark = Math.max(1 - clamp(t / 0.35), prog(t, T.fadeOut, T.end - T.fadeOut))
  if (dark > 0) {
    g.globalAlpha = dark
    g.fillStyle = '#16100c'
    g.fillRect(0, 0, W, H)
    g.globalAlpha = 1
  }
}

function scene(g: CanvasRenderingContext2D, t: number) {
  g.save()
  if (t < T.rip) deskFrame(g, t)
  else {
    corkFrame(g, t)
    if (t < T.rip + RIP) rip(g, t)
  }
  g.restore()
  g.save()
  if (t > T.keep) endCard(g, t)
  g.restore()
}

// How far the picture slides in one frame, in screen pixels.
function cameraSpeed(t: number) {
  const dt = 1 / FPS
  const cam = (u: number) => (u < T.rip ? deskCamera(u) : corkCamera(u))
  const a = cam(t - dt)
  const c = cam(t)
  const pan = Math.hypot(c.x - a.x, c.y - a.y) * c.z
  const zoom = (Math.abs(c.z - a.z) / c.z) * (W / 2)
  return pan + zoom
}

// Moments where paper itself flies fast enough to smear.
const BUSY: [number, number][] = [
  [T.gust - 0.1, T.rip + 0.7],
  [T.tagsBack, T.pins[2]!],
  [T.sticky - 0.2, T.board + 0.5],
]

let accum: HTMLCanvasElement | null = null

// A 180° shutter: fast frames are the average of several moments inside it.
export function drawFrame(g: CanvasRenderingContext2D, t: number) {
  const speed = cameraSpeed(t)
  // about one sub-frame per 4 px of travel while the shutter is open
  let subs = Math.min(20, Math.ceil((speed * 0.5) / 4))
  if (BUSY.some(([a, b]) => t >= a && t <= b)) subs = Math.max(subs, 6)
  if (subs <= 1 || t < 1 / FPS) scene(g, t)
  else {
    accum ??= canvas(W, H)
    const ag = ctx2d(accum)
    smoothing(ag)
    const shutter = 0.5 / FPS
    holdBoil(t)
    for (let k = 0; k < subs; k++) {
      const u = t - shutter / 2 + (shutter * (k + 0.5)) / subs
      ag.setTransform(1, 0, 0, 1, 0, 0)
      ag.globalAlpha = 1
      ag.globalCompositeOperation = 'source-over'
      scene(ag, u)
      g.setTransform(1, 0, 0, 1, 0, 0)
      g.globalCompositeOperation = 'source-over'
      g.globalAlpha = 1 / (k + 1)
      g.drawImage(accum, 0, 0)
    }
    g.globalAlpha = 1
    holdBoil(null)
  }
  g.save()
  post(g, t)
  g.restore()
}

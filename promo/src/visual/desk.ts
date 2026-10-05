// Scene 1, on a paper desk: a project folder spills its loose ends, the camera
// visits three of them, then a busy session blows them all away.

import { HITS, T } from '../shared/timeline'
import {
  Key, Pt, TAU, bezier, clamp, deg, easeInOutCubic, easeInQuad, easeOutBack, easeOutCubic,
  hash, lerp, noise1, prog, track, wobble,
} from './core'
import { FONTS, handText, ink, windCurl } from './ink'
import { Sprite, bake, cutout, outline, paperFill, tape } from './paper'
import { TAGS, Tag, drawTag } from './tags'
import { miniTerminal } from './terminal'

const FOLDER = { x: 960, y: 712, w: 460, h: 300 }
const THREAD = '#c8352a'
let back: Sprite
let front: Sprite
let label: Sprite
let tapeA: Sprite
let tapeB: Sprite

export function bakeDesk() {
  const { w, h } = FOLDER
  back = bake(w, h + 40, g => {
    const tab: Pt[] = [
      { x: 0, y: 44 }, { x: 12, y: 6 }, { x: 22, y: 0 }, { x: 150, y: 0 }, { x: 164, y: 8 }, { x: 178, y: 44 },
      { x: w, y: 44 }, { x: w, y: h + 40 }, { x: 0, y: h + 40 },
    ]
    paperFill(g, tab, '#c39a68', { seed: 71 })
  })
  front = bake(w + 20, h - 50, g => {
    const pts = outline(w + 20, h - 50, 72, {}, 0)
    paperFill(g, pts, '#d6b07c', { seed: 72 })
    g.strokeStyle = 'rgba(90,60,30,0.25)'
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(8, 10)
    g.lineTo(w + 12, 12)
    g.stroke()
  })
  label = cutout(320, 70, '#fbf7ef', 73, {
    content: g => handText(g, 'my-project/', 160, 50, { size: 38, font: FONTS.marker, weight: 400, jitter: 0, align: 'center' }),
  })
  tapeA = tape(90, 30, 74)
  tapeB = tape(84, 28, 75)
}

// Thread start points along the folder's mouth, per tag.
const MOUTH: Record<string, number> = { bug: -120, key: 110, task: 170, tests: -175, deploy: 10 }

const detachAt = (tag: Tag) => HITS.detach(tag.desk.x)

// Where each tag is at time t in scene 1 (it flies off once the gust hits).
export function tagPose(tag: Tag, t: number) {
  const i = TAGS.indexOf(tag)
  const sway = Math.sin(t * 1.4 + i * 1.7) * 0.012
  const d = tag.desk
  const tau = t - detachAt(tag)
  if (tau <= 0) {
    // a little tremble as the session heats up
    const shiver = clamp((t - T.session - 0.6) / 0.8) * Math.sin(t * 38 + i) * 2.2
    return { x: d.x + shiver, y: d.y, rot: d.rot + sway, sx: 1, lift: 0 }
  }
  const r1 = hash(i, 91)
  const r2 = hash(i, 92)
  const vx = 950 + r1 * 600
  const vy = -380 - r2 * 360
  return {
    x: d.x + vx * tau + 0.5 * 900 * tau * tau,
    y: d.y + vy * tau + 0.5 * 500 * tau * tau,
    rot: d.rot + (r1 - 0.5) * 9 * tau + tau * 2,
    sx: Math.cos(tau * (8 + r2 * 5)),
    lift: Math.min(1.3, tau * 4),
  }
}

function holeWorld(tag: Tag, pose: { x: number; y: number; rot: number; sx: number }) {
  const c = Math.cos(pose.rot)
  const s = Math.sin(pose.rot)
  const hx = tag.hole.x * pose.sx
  return { x: pose.x + hx * c - tag.hole.y * s, y: pose.y + hx * s + tag.hole.y * c }
}

function thread(g: CanvasRenderingContext2D, tag: Tag, i: number, t: number) {
  const start = { x: FOLDER.x + MOUTH[tag.id]!, y: FOLDER.y - FOLDER.h / 2 + 34 }
  const grow = easeOutCubic(prog(t, T.threads + i * 0.12, Math.max(0.25, tag.pop - T.threads - i * 0.12)))
  if (grow <= 0) return
  const snap = detachAt(tag) + 0.09
  let end = holeWorld(tag, tagPose(tag, Math.min(t, snap)))
  let progress = grow
  let whip = 0
  if (t > snap) {
    const k = prog(t, snap, 0.45)
    progress = 1 - easeOutCubic(k)
    whip = (1 - k) * 40
  }
  if (progress <= 0.01) return
  const dx = end.x - start.x
  const dy = end.y - start.y
  const c1 = { x: start.x + dx * 0.1, y: start.y - 90 }
  const c2 = { x: end.x - dx * 0.35, y: end.y - dy * 0.1 + 60 }
  const pts: Pt[] = []
  const n = 60
  const len = Math.hypot(dx, dy)
  for (let k = 0; k <= n; k++) {
    const u = k / n
    const p = bezier(start, c1, c2, end, u)
    const q = bezier(start, c1, c2, end, Math.min(1, u + 0.01))
    const tx = q.x - p.x
    const ty = q.y - p.y
    const tl = Math.hypot(tx, ty) || 1
    const wave = Math.sin(u * TAU * (len / 420) + i) * 16 * Math.sin(u * Math.PI)
    const sway = Math.sin(t * 1.3 + i + u * 3) * 5 * Math.sin(u * Math.PI)
    const w2 = whip * Math.sin(u * 14 - t * 30) * u
    const off = wave + sway + w2
    pts.push({ x: p.x - (ty / tl) * off, y: p.y + (tx / tl) * off })
  }
  ink(g, pts, { w: 4.2, color: THREAD, t, seed: 200 + i, progress, taper: 0.2, jitter: 0.8 })
  // a darker twist line along the thread
  ink(g, pts, { w: 1.3, color: '#7d1a12', t, seed: 260 + i, progress, alpha: 0.55, jitter: 0.6 })
}

export function deskCamera(t: number) {
  const keys: [number, number, number, number][] = [
    [0, 960, 560, 1.0],
    [3.2, 960, 560, 1.05],
    [T.bug + 0.6, 492, 346, 1.85],
    [T.key - 0.05, 500, 340, 1.92],
    [T.key + 0.55, 1440, 316, 1.86],
    [T.todo - 0.05, 1452, 312, 1.92],
    [T.todo + 0.6, 1505, 790, 1.86],
    [T.session - 0.6, 1492, 786, 1.94],
    [T.session + 0.55, 880, 610, 0.84],
    [T.gust, 900, 600, 0.86],
    [T.rip + 0.6, 1060, 560, 0.9],
  ]
  const x = track(keys.map(k => [k[0], k[1]] as Key), t)
  const y = track(keys.map(k => [k[0], k[2]] as Key), t)
  const z = track(keys.map(k => [k[0], k[3]] as Key), t)
  return { x, y, z, rot: deg(noise1(t * 0.25, 4) * 0.6) }
}

export function drawDesk(g: CanvasRenderingContext2D, t: number) {
  // the folder drops in and settles
  const fall = easeInQuad(prog(t, 0, T.folderLand))
  const fy = lerp(-420, FOLDER.y, fall)
  const squash = wobble(t - T.folderLand, 4, 7) * 0.05
  const gustShake = Math.sin(t * 50) * 4 * clamp(1 - Math.abs(t - T.gust - 0.2) * 3)
  const fx = FOLDER.x + gustShake
  const lift = 1 - fall
  back.draw(g, fx, fy - 22, { sy: 1 - squash, sx: 1 + squash, lift })
  if (t > T.folderLand) TAGS.forEach((tag, i) => thread(g, tag, i, t))
  front.draw(g, fx + 4, fy + 34, { sy: 1 - squash, sx: 1 + squash, lift: lift * 0.9 })
  const lp = easeOutBack(prog(t, T.folderLand + 0.12, 0.3), 2)
  if (lp > 0) {
    label.draw(g, fx - 50, fy + 60, { rot: deg(-3), scale: lp })
    tapeA.draw(g, fx - 205, fy + 40, { rot: deg(-38), scale: lp, shadow: 0.4 })
    tapeB.draw(g, fx + 102, fy + 78, { rot: deg(-30), scale: lp, shadow: 0.4 })
  }

  // the session: a busy terminal slides in from the left
  const slide = easeOutBack(prog(t, T.session, 0.5), 1.2)
  if (slide > 0) miniTerminal(g, lerp(-520, 330, slide), 905, t)

  for (const tag of TAGS) {
    const appear = prog(t, tag.pop - 0.05, 0.42)
    const pose = tagPose(tag, t)
    if (pose.x > 2600 || pose.y < -700) continue
    drawTag(g, tag, pose.x, pose.y, t, { rot: pose.rot, sx: pose.sx, lift: pose.lift, appear })
  }

  // the gust
  for (let i = 0; i < 6; i++) {
    const k = prog(t, T.gust - 0.3 + hash(i, 6) * 0.25, 0.85)
    if (k <= 0 || k >= 1) continue
    const y = 230 + i * 150 + hash(i, 3) * 50
    const x = 420 + hash(i, 4) * 260 + easeInOutCubic(k) * 520
    windCurl(g, x, y, 460 + hash(i, 5) * 300, k, { color: '#4f5d6b', t, seed: 400 + i, w: 4.5, alpha: 0.8 })
  }
}

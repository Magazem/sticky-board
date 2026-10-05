// The loose ends: paper tags on red thread. They spill out of the project folder,
// blow away when the session gets busy, and end up pinned to the board.

import { T } from '../shared/timeline'
import { Pt, TAU, clamp, deg, easeOutBack, easeOutCubic, prog } from './core'
import { FONTS, bug, handText, ink, key, moon, motionLines, snail, sparkle, underline } from './ink'
import { Sprite, cutout } from './paper'

export type Tag = {
  id: string
  w: number
  h: number
  color: string
  desk: { x: number; y: number; rot: number } // where it lies in scene 1
  board: { x: number; y: number; rot: number; s: number } | null // where it is pinned
  hole: Pt // thread attachment, local
  pop: number // when it appears
  sprite?: Sprite
}

export const TAGS: Tag[] = [
  {
    id: 'bug', w: 340, h: 214, color: '#f5a3b7',
    desk: { x: 470, y: 330, rot: deg(-7) },
    board: { x: 430, y: 196, rot: deg(-6), s: 0.62 },
    hole: { x: 140, y: -78 }, pop: T.tagPops[0]!,
  },
  {
    id: 'key', w: 340, h: 214, color: '#9fd3f2',
    desk: { x: 1450, y: 300, rot: deg(6) },
    board: { x: 960, y: 172, rot: deg(3), s: 0.62 },
    hole: { x: -140, y: -78 }, pop: T.tagPops[1]!,
  },
  {
    id: 'task', w: 330, h: 230, color: '#ffe066',
    desk: { x: 1530, y: 790, rot: deg(-4) },
    board: { x: 1490, y: 200, rot: deg(5), s: 0.62 },
    hole: { x: -135, y: -85 }, pop: T.tagPops[2]!,
  },
  {
    id: 'tests', w: 230, h: 130, color: '#b2e3a6',
    desk: { x: 330, y: 640, rot: deg(8) },
    board: null,
    hole: { x: 88, y: -38 }, pop: T.tagPops[3]!,
  },
  {
    id: 'deploy', w: 240, h: 130, color: '#f9c48c',
    desk: { x: 990, y: 175, rot: deg(-3) },
    board: null,
    hole: { x: -92, y: 36 }, pop: T.tagPops[4]!,
  },
]

export function bakeTags() {
  TAGS.forEach((tag, i) => {
    tag.sprite = cutout(tag.w, tag.h, tag.color, 300 + i * 17, {
      torn: i % 2 ? { l: true, b: true } : { r: true, b: true },
      amp: 5,
      content: g => {
        // faint ruled lines, like a page torn from a notebook
        g.strokeStyle = 'rgba(70,90,140,0.16)'
        g.lineWidth = 1.2
        for (let y = 38; y < tag.h - 8; y += 30) {
          g.beginPath()
          g.moveTo(0, y)
          g.lineTo(tag.w, y)
          g.stroke()
        }
      },
    })
  })
}

// The reinforcement ring around the string hole.
function hole(g: CanvasRenderingContext2D, p: Pt) {
  g.fillStyle = 'rgba(255,255,255,0.85)'
  g.beginPath()
  g.arc(p.x, p.y, 13, 0, TAU)
  g.fill()
  g.strokeStyle = 'rgba(0,0,0,0.12)'
  g.lineWidth = 1
  g.stroke()
  g.fillStyle = '#3b2a1f'
  g.beginPath()
  g.arc(p.x, p.y, 5.5, 0, TAU)
  g.fill()
}

// Draws the tag with its doodles at (x, y). `t` is film time.
export function drawTag(
  g: CanvasRenderingContext2D,
  tag: Tag,
  x: number,
  y: number,
  t: number,
  o: { rot: number; s?: number; sx?: number; lift?: number; appear?: number; alpha?: number },
) {
  const appear = o.appear ?? 1
  if (appear <= 0) return
  const s = (o.s ?? 1) * (0.2 + 0.8 * easeOutBack(clamp(appear), 2.2))
  const sx = o.sx ?? 1
  tag.sprite!.draw(g, x, y, { rot: o.rot, scale: s, sx, lift: o.lift, alpha: o.alpha })
  g.save()
  g.translate(x, y)
  g.rotate(o.rot)
  g.scale(s * sx, s)
  if (o.alpha !== undefined) g.globalAlpha = o.alpha
  // doodles write on just after the tag lands
  const written = clamp((appear - 0.6) / 0.4)
  if (sx > 0.25) content(g, tag, t, written)
  if (sx > 0) hole(g, tag.hole)
  g.restore()
}

function content(g: CanvasRenderingContext2D, tag: Tag, t: number, p: number) {
  switch (tag.id) {
    case 'bug': {
      // the bug comes alive while the narrator talks about it
      const walk = Math.max(0, t - T.bug + 0.2)
      const dx = Math.min(walk, 1.6) * 10
      bug(g, -92 + dx, 22, 0.86, { t, progress: p, walk: walk > 0 && t < T.key + 0.4 ? walk : 0 })
      handText(g, 'spotted at', -20, -34, { size: 40, progress: p, t, seed: 3 })
      handText(g, '2:13 am', -16, 22, { size: 58, progress: p, t, seed: 4, color: '#b3261e' })
      const m = prog(t, T.midnight - 0.1, 0.5)
      moon(g, 128, 54, 20, { t, progress: m, seed: 8 })
      if (m > 0) {
        sparkle(g, 90, 80, 11, { t, progress: m, w: 2.4 })
        sparkle(g, 150, 18, 8, { t, progress: prog(t, T.midnight + 0.1, 0.4), w: 2.2, seed: 9 })
      }
      break
    }
    case 'key': {
      const spin = prog(t, T.rotate - 0.05, 0.75)
      const rot = deg(-18) + easeOutCubic(spin) * TAU
      key(g, -8, -10, 1.15, rot, { t, progress: p })
      motionLines(g, -8, -10, 78, prog(t, T.rotate + 0.15, 0.6), { color: '#1d3f66', t })
      handText(g, 'rotate key!!', -112, 78, { size: 42, progress: p, t, seed: 5 })
      underline(g, -112, 92, 88, { w: 2.6, t, progress: p, seed: 2 })
      break
    }
    case 'task': {
      handText(g, 'wire retries', -126, -30, { size: 50, progress: p, t, seed: 6, font: FONTS.hand2, weight: 400 })
      handText(g, '— claude', 34, 10, { size: 30, progress: p, t, seed: 7, color: '#6b5d4f' })
      const later = prog(t, T.eventually - 0.05, 0.7)
      if (later > 0) handText(g, '(eventually)', -120, 14, { size: 30, progress: later, t, seed: 8, color: '#b3261e' })
      const crawl = clamp((t - T.todo) / 3.2)
      const sx = -92 + crawl * 120
      snail(g, sx, 82, 0.62, { t, progress: p, crawl: t })
      // slime trail
      if (crawl > 0) {
        const trail: Pt[] = []
        for (let x = -150; x <= sx - 26; x += 6) trail.push({ x, y: 86 + Math.sin(x * 0.05) * 1.2 })
        if (trail.length > 1) ink(g, trail, { w: 2, t, color: 'rgba(60,90,60,0.5)', alpha: 0.5, jitter: 0.4 })
      }
      break
    }
    case 'tests':
      handText(g, 'tests?', -50, 16, { size: 50, progress: p, t, seed: 9 })
      break
    case 'deploy':
      handText(g, 'deploy?!', -78, 14, { size: 48, progress: p, t, seed: 10, color: '#7a2e12' })
      break
  }
}

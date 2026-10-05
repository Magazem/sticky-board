// Hands in the story: Claude's pencil, your pointing hand, and a burst of paper
// confetti for a satisfying tick.

import { TAU, clamp, hash } from './core'
import { INK, ink } from './ink'

// A yellow pencil with its tip at (0, 0), body running along +x before rotation.
export function pencil(g: CanvasRenderingContext2D, x: number, y: number, angle: number, t: number, lift = 0.5, s = 1) {
  g.save()
  g.translate(x, y)
  g.scale(s, s)
  // shadow
  g.save()
  g.translate(10 + lift * 26, 16 + lift * 34)
  g.rotate(angle)
  g.globalCompositeOperation = 'multiply'
  g.fillStyle = `rgba(40,25,10,${0.28 - lift * 0.08})`
  g.filter = 'blur(5px)'
  g.beginPath()
  g.moveTo(0, 0)
  g.lineTo(44, -15)
  g.lineTo(306, -15)
  g.lineTo(306, 15)
  g.lineTo(44, 15)
  g.closePath()
  g.fill()
  g.restore()

  g.rotate(angle)
  // wood cone + graphite
  g.fillStyle = '#ebcaa0'
  g.beginPath()
  g.moveTo(10, -3.5)
  g.lineTo(44, -15)
  g.quadraticCurveTo(40, -8, 44, -4)
  g.quadraticCurveTo(40, 2, 44, 6)
  g.quadraticCurveTo(40, 11, 44, 15)
  g.lineTo(10, 3.5)
  g.closePath()
  g.fill()
  g.fillStyle = '#3a3634'
  g.beginPath()
  g.moveTo(0, 0)
  g.lineTo(12, -4.2)
  g.lineTo(12, 4.2)
  g.closePath()
  g.fill()
  // body facets
  const facet = (y0: number, y1: number, c: string) => {
    g.fillStyle = c
    g.fillRect(44, y0, 208, y1 - y0)
  }
  facet(-15, -5, '#f9d66a')
  facet(-5, 5, '#f3bf3b')
  facet(5, 15, '#d9a21c')
  // ferrule + eraser
  g.fillStyle = '#cfcac3'
  g.fillRect(252, -15.5, 30, 31)
  g.fillStyle = '#a19b93'
  for (let i = 0; i < 4; i++) g.fillRect(256 + i * 7, -15.5, 2, 31)
  g.fillStyle = '#ef9aa5'
  g.beginPath()
  g.moveTo(282, -15)
  g.lineTo(300, -15)
  g.quadraticCurveTo(310, -15, 310, 0)
  g.quadraticCurveTo(310, 15, 300, 15)
  g.lineTo(282, 15)
  g.closePath()
  g.fill()
  // outline
  ink(g, [{ x: 0, y: 0 }, { x: 44, y: -15 }, { x: 300, y: -15 }], { w: 2.4, t, seed: 601, jitter: 0.5 })
  ink(g, [{ x: 0, y: 0 }, { x: 44, y: 15 }, { x: 300, y: 15 }], { w: 2.4, t, seed: 602, jitter: 0.5 })
  ink(g, [{ x: 44, y: -15 }, { x: 44, y: 15 }], { w: 1.6, t, seed: 603, jitter: 0.4 })
  g.restore()
}

// A cartoon pointing hand (the user), fingertip at (0, 0).
export function hand(g: CanvasRenderingContext2D, x: number, y: number, t: number, press = 0, s = 1) {
  g.save()
  g.translate(x, y)
  const k = s * (1 - press * 0.08)
  g.scale(k, k)
  g.rotate(-0.18)
  const path = new Path2D()
  path.arc(0, 11, 11, Math.PI, 0)
  path.lineTo(11, 50)
  path.arc(21, 50, 10, Math.PI, 0)
  path.arc(39.5, 57, 8.5, Math.PI * 1.1, 0)
  path.arc(54, 65, 6.8, Math.PI * 1.2, 0)
  path.lineTo(61, 94)
  path.quadraticCurveTo(60, 114, 40, 115)
  path.lineTo(6, 115)
  path.quadraticCurveTo(-14, 113, -18, 94)
  path.lineTo(-22, 78)
  path.quadraticCurveTo(-36, 62, -31, 53)
  path.quadraticCurveTo(-24, 46, -13, 60)
  path.lineTo(-11, 62)
  path.closePath()

  // shadow
  g.save()
  g.translate(12 - press * 6, 18 - press * 8)
  g.globalCompositeOperation = 'multiply'
  g.fillStyle = 'rgba(30,20,10,0.32)'
  g.filter = 'blur(6px)'
  g.fill(path)
  g.fillRect(-12, 114, 66, 22)
  g.restore()

  g.fillStyle = '#fdfaf2'
  g.fill(path)
  g.fillStyle = '#e9e2d4'
  g.fillRect(-12, 114, 66, 22)
  const o = { w: 3, t, jitter: 0.6, color: INK }
  // outline via sampled points of the path's main contour
  const outline = [
    { x: -11, y: 62 }, { x: -11, y: 11 }, { x: -8, y: 3 }, { x: 0, y: 0 }, { x: 8, y: 3 }, { x: 11, y: 11 },
    { x: 11, y: 50 }, { x: 13, y: 43 }, { x: 21, y: 40 }, { x: 29, y: 43 }, { x: 31, y: 50 }, { x: 31.5, y: 55 },
    { x: 34, y: 50 }, { x: 40, y: 48.5 }, { x: 46, y: 51 }, { x: 48, y: 57 }, { x: 48, y: 62 },
    { x: 51, y: 59 }, { x: 56, y: 59 }, { x: 60.5, y: 64 }, { x: 61, y: 94 }, { x: 57, y: 108 }, { x: 40, y: 115 },
    { x: 6, y: 115 }, { x: -10, y: 110 }, { x: -18, y: 94 }, { x: -22, y: 78 }, { x: -31, y: 64 }, { x: -30, y: 53 },
    { x: -23, y: 49 }, { x: -13, y: 60 },
  ]
  ink(g, outline, { ...o, seed: 701 })
  ink(g, [{ x: 21, y: 60 }, { x: 22, y: 72 }], { ...o, w: 2.2, seed: 702 })
  ink(g, [{ x: 40, y: 66 }, { x: 40, y: 76 }], { ...o, w: 2.2, seed: 703 })
  ink(g, [{ x: -12, y: 74 }, { x: -2, y: 82 }], { ...o, w: 2.2, seed: 704 })
  ink(g, [{ x: -12, y: 114 }, { x: 54, y: 114 }, { x: 54, y: 136 }, { x: -12, y: 136 }, { x: -12, y: 114 }], { ...o, w: 2.6, seed: 705 })
  g.restore()
}

const CONFETTI = ['#ffe066', '#f5a3b7', '#9fd3f2', '#b2e3a6', '#f9c48c', '#fbf7ef', '#d8432f']

export function confetti(g: CanvasRenderingContext2D, x: number, y: number, t0: number, t: number, seed: number, n = 26, power = 1) {
  const tau = t - t0
  if (tau <= 0 || tau > 1.3) return
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (hash(seed, i) - 0.5) * 2.4
    const v = (380 + hash(seed, i, 1) * 520) * power
    const px = x + Math.cos(a) * v * tau
    const py = y + Math.sin(a) * v * tau + 0.5 * 1500 * tau * tau
    const spin = (hash(seed, i, 2) - 0.5) * 18 * tau
    const flip = Math.cos(tau * (10 + hash(seed, i, 3) * 10))
    const alpha = 1 - clamp((tau - 0.75) / 0.5)
    const w = 9 + hash(seed, i, 4) * 8
    const h = 5 + hash(seed, i, 5) * 5
    g.save()
    g.translate(px, py)
    g.rotate(spin)
    g.scale(1, flip)
    g.globalAlpha = alpha
    g.fillStyle = CONFETTI[i % CONFETTI.length]!
    g.fillRect(-w / 2, -h / 2, w, h)
    g.restore()
  }
}

// Concentric "click" rings around a point.
export function clickRings(g: CanvasRenderingContext2D, x: number, y: number, k: number, t: number, color = INK) {
  if (k <= 0 || k >= 1) return
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU - 0.5
    const r0 = 18 + k * 20
    const r1 = 30 + k * 34
    ink(g, [{ x: x + Math.cos(a) * r0, y: y + Math.sin(a) * r0 }, { x: x + Math.cos(a) * r1, y: y + Math.sin(a) * r1 }], {
      w: 3.4,
      color,
      t,
      seed: 800 + i,
      alpha: 1 - k,
      taper: 0.8,
    })
  }
}

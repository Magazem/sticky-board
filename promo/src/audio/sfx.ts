// Foley, synthesised: paper slaps and tears, pushpins in cork, pencil and marker
// scribbles, typing, a typewriter, chimes. The cue sheet reads the shared
// timeline, so every sound sits on the frame where its picture happens.

import { HITS, T } from '../shared/timeline'
import { Biquad, Bus, SR, ad, db, filter, mtof, n, noise, rng, tail } from './dsp'
import { bell, glock, pluck } from './instruments'

// --- generators ---

function pop(midi: number, seed = 1) {
  const len = n(0.14)
  const out = new Float32Array(len)
  const f0 = mtof(midi)
  let ph = 0
  for (let i = 0; i < len; i++) {
    const t = i / SR
    const f = f0 * (0.7 + 0.5 * Math.min(1, t / 0.025))
    ph += (2 * Math.PI * f) / SR
    out[i] = Math.sin(ph) * Math.exp(-t / 0.045) * Math.min(1, t / 0.002)
  }
  const tick = ad(filter(noise(n(0.02), seed), 'hp', 2500), 0.0005, 0.004)
  for (let i = 0; i < tick.length; i++) out[i]! += tick[i]! * 0.35
  return out
}

function slap(seed = 1, size = 1) {
  const len = n(0.22)
  const out = filter(noise(len, seed), 'lp', 2600 + 1500 * (1 - size))
  ad(out, 0.0006, 0.022 + size * 0.012)
  for (let i = 0; i < len; i++) {
    const t = i / SR
    out[i]! += Math.sin(2 * Math.PI * (130 + 60 * (1 - size)) * t) * Math.exp(-t / 0.03) * 0.7 * size
  }
  const crackle = ad(filter(noise(n(0.05), seed + 1), 'hp', 3500), 0.0003, 0.008)
  for (let i = 0; i < crackle.length; i++) out[i]! += crackle[i]! * 0.25
  return tail(out)
}

function thunk(seed = 1) {
  const len = n(0.3)
  const out = new Float32Array(len)
  let ph = 0
  for (let i = 0; i < len; i++) {
    const t = i / SR
    const f = 72 + 70 * Math.exp(-t / 0.03)
    ph += (2 * Math.PI * f) / SR
    out[i] = Math.sin(ph) * Math.exp(-t / 0.075) * 0.9
    out[i]! += Math.sin(2 * Math.PI * 3100 * t) * Math.exp(-t / 0.008) * 0.12
  }
  const knock = ad(filter(noise(n(0.08), seed), 'bp', 850, 2.2), 0.0005, 0.018)
  for (let i = 0; i < knock.length; i++) out[i]! += knock[i]! * 1.4
  return tail(out)
}

// Paper fluttering: bright noise with a jittery, flapping envelope.
function rustle(dur: number, seed = 1, rate = 16) {
  const len = n(dur)
  const out = filter(filter(noise(len, seed), 'bp', 3800, 0.6), 'hp', 1200)
  const r = rng(seed + 5)
  let flap = 0
  let target = 0
  for (let i = 0; i < len; i++) {
    if (i % Math.round(SR / rate) === 0) target = 0.25 + r() * 0.75
    flap += (target - flap) * 0.004
    const k = i / len
    out[i]! *= flap * Math.sin(Math.PI * Math.min(1, k * 1.2)) ** 0.6
  }
  return out
}

function whoosh(dur: number, f0: number, f1: number, seed = 1, q = 0.9) {
  const len = n(dur)
  const out = noise(len, seed)
  const bp = new Biquad('bp', f0, q)
  const lp = new Biquad('lp', 6000)
  for (let i = 0; i < len; i++) {
    const k = i / len
    if (i % 32 === 0) bp.set('bp', f0 * (f1 / f0) ** k, q)
    const env = Math.sin(Math.PI * k) ** 1.6
    out[i] = lp.tick(bp.tick(out[i]!)) * env * 2.2
  }
  return out
}

// Paper tearing: a crackle that thickens, over a ragged band of noise.
function tear(dur: number, seed = 1) {
  const len = n(dur)
  const out = filter(filter(noise(len, seed), 'bp', 2400, 0.7), 'hp', 700)
  const r = rng(seed + 9)
  let amp = 0
  for (let i = 0; i < len; i++) {
    const k = i / len
    if (i % 90 === 0) amp = (0.3 + r() * 0.7) * (0.35 + k * 0.9)
    out[i]! *= amp * Math.min(1, (1 - k) * 8)
  }
  for (let c = 0; c < dur * 260; c++) {
    const at = Math.floor(r() ** 0.7 * (len - 400))
    const click = ad(filter(noise(n(0.004), seed + c), 'hp', 2000), 0.0002, 0.0012)
    for (let i = 0; i < click.length; i++) out[at + i]! += click[i]! * (0.4 + r() * 0.8)
  }
  return out
}

// Pencil or marker strokes: gated noise in a writing rhythm.
function scribble(dur: number, seed = 1, o: { center?: number; rate?: number; tone?: number } = {}) {
  const len = n(dur)
  const center = o.center ?? 4200
  const out = filter(filter(noise(len, seed), 'bp', center, 1.1), 'hp', 1500)
  const r = rng(seed)
  const rate = o.rate ?? 9
  let phase = 0
  let speed = rate
  for (let i = 0; i < len; i++) {
    if (i % 2400 === 0) speed = rate * (0.7 + r() * 0.6)
    phase += speed / SR
    const stroke = Math.max(0, Math.sin(phase * Math.PI * 2)) ** 0.7
    const k = i / len
    out[i]! *= stroke * Math.min(1, k * 12, (1 - k) * 12)
    if (o.tone) out[i]! += Math.sin(2 * Math.PI * (o.tone + Math.sin(phase * 6) * 120) * (i / SR)) * stroke * 0.05
  }
  return out
}

function keyClick(seed: number) {
  const len = n(0.05)
  const out = ad(filter(noise(len, seed), 'bp', 3200, 1.3), 0.0004, 0.006)
  for (let i = 0; i < len; i++) {
    const t = i / SR
    out[i]! += Math.sin(2 * Math.PI * 320 * t) * Math.exp(-t / 0.01) * 0.3
  }
  return out
}

function typing(dur: number, rate: number, seed = 1) {
  const len = n(dur)
  const out = new Float32Array(len)
  const r = rng(seed)
  let t = 0
  while (t < dur) {
    const c = keyClick(seed + Math.floor(t * 1000))
    const at = Math.floor(t * SR)
    const g = 0.5 + r() * 0.5
    for (let i = 0; i < c.length && at + i < len; i++) out[at + i]! += c[i]! * g
    t += (0.5 + r()) / rate
  }
  return out
}

function typewriter(dur: number, seed = 1) {
  const len = n(dur + 0.2)
  const out = new Float32Array(len)
  const r = rng(seed)
  let t = 0
  while (t < dur) {
    const at = Math.floor(t * SR)
    const c = ad(filter(noise(n(0.06), seed + at), 'bp', 1800, 1.4), 0.0004, 0.01)
    for (let i = 0; i < c.length && at + i < len; i++) {
      const tt = i / SR
      out[at + i]! += c[i]! * 1.2 + Math.sin(2 * Math.PI * 2600 * tt) * Math.exp(-tt / 0.012) * 0.15 + Math.sin(2 * Math.PI * 180 * tt) * Math.exp(-tt / 0.02) * 0.4
    }
    t += 0.06 + r() * 0.05
  }
  return out
}

// A bunch of keys on a ring.
function jingle(seed = 1) {
  const len = n(0.7)
  const out = new Float32Array(len)
  const r = rng(seed)
  for (let h = 0; h < 9; h++) {
    const at = Math.floor((h * 0.045 + r() * 0.03) * SR)
    const freqs = [3100 + r() * 2500, 5200 + r() * 2500, 7900 + r() * 1500]
    for (let i = 0; at + i < len && i < n(0.25); i++) {
      const t = i / SR
      let v = 0
      for (const f of freqs) v += Math.sin(2 * Math.PI * f * t) * Math.exp(-t / (0.03 + r() * 0.0001))
      out[at + i]! += v * 0.25 * (1 - h / 12)
    }
  }
  return out
}

function slideWhistle(dur: number, from: number, to: number) {
  const len = n(dur)
  const out = new Float32Array(len)
  const breath = filter(noise(len, 77), 'bp', 1800, 0.8)
  let ph = 0
  for (let i = 0; i < len; i++) {
    const k = i / len
    const f = mtof(from + (to - from) * (k < 0.15 ? 0 : (k - 0.15) / 0.85)) * (1 + 0.012 * Math.sin(2 * Math.PI * 6 * (i / SR)))
    ph += (2 * Math.PI * f) / SR
    const env = Math.min(1, k * 20) * Math.min(1, (1 - k) * 6)
    out[i] = (Math.sin(ph) + breath[i]! * 0.08) * env
  }
  return out
}

function boop(midi: number) {
  const len = n(0.18)
  const out = new Float32Array(len)
  let ph = 0
  for (let i = 0; i < len; i++) {
    const t = i / SR
    ph += (2 * Math.PI * mtof(midi) * (1 - 0.25 * Math.min(1, t / 0.12))) / SR
    out[i] = Math.sin(ph) * Math.exp(-t / 0.06) * Math.min(1, t / 0.004)
  }
  return out
}

function splash(dur = 1.4, seed = 3) {
  const len = n(dur)
  const out = filter(filter(noise(len, seed), 'hp', 4500), 'peak', 8000, 1, 4)
  ad(out, 0.002, dur * 0.3)
  return out
}

function click(seed = 1) {
  const len = n(0.12)
  const out = new Float32Array(len)
  for (const [at, g, f] of [[0, 1, 3800], [0.075, 0.6, 3000]] as const) {
    const c = ad(filter(noise(n(0.02), seed + at * 100), 'bp', f, 2), 0.0003, 0.003)
    const s = Math.floor(at * SR)
    for (let i = 0; i < c.length; i++) out[s + i]! += c[i]! * g
  }
  return out
}

function patter(dur: number, seed = 1) {
  const len = n(dur)
  const out = new Float32Array(len)
  const r = rng(seed)
  for (let t = 0; t < dur; t += 0.06 + r() * 0.03) {
    const c = ad(filter(noise(n(0.012), seed + Math.floor(t * 999)), 'bp', 5200, 2), 0.0003, 0.0018)
    const at = Math.floor(t * SR)
    for (let i = 0; i < c.length && at + i < len; i++) out[at + i]! += c[i]! * (0.5 + r() * 0.5)
  }
  return out
}

// --- the cue sheet ---

export function renderSfx(length: number) {
  const dry = new Bus(length)
  const send = new Bus(length)
  const cue = (buf: Float32Array, at: number, gainDb: number, pan = 0, wet = 0.15) => {
    dry.add(buf, at, db(gainDb), pan)
    if (wet) send.add(buf, at, db(gainDb) * wet, pan)
  }
  const sweep = (buf: Float32Array, at: number, gainDb: number, from: number, to: number, wet = 0.15) => {
    dry.addMoving(buf, at, db(gainDb), from, to)
    if (wet) send.addMoving(buf, at, db(gainDb) * wet, from, to)
  }
  // screen x (0..1920) to pan
  const px = (x: number) => Math.max(-0.8, Math.min(0.8, (x - 960) / 1100))

  // scene 1: the folder lands and spills its loose ends
  sweep(whoosh(0.32, 500, 1600, 2), 0.02, -24, 0, 0)
  cue(slap(3, 1.3), T.folderLand, -9)
  cue(thunk(4), T.folderLand, -14)
  const popNotes = [72, 76, 79, 81, 84]
  T.tagPops.forEach((t, i) => {
    cue(pop(popNotes[i]!, 10 + i), t, -17, [-0.5, 0.5, 0.55, -0.6, 0][i])
    cue(rustle(0.2, 20 + i), t - 0.04, -27, 0)
  })
  cue(scribble(1.4, 30, { center: 3600 }), T.tagPops[0]! + 0.2, -30, -0.2)
  // the camera visits each loose end
  for (const t of [T.bug, T.key, T.todo]) sweep(whoosh(0.6, 300, 1100, Math.round(t * 10), 0.7), t - 0.05, -27, -0.2, 0.2)
  cue(patter(1.4, 41), T.bug + 0.2, -31, -0.3)
  cue(glock(91, 1.2), T.midnight + 0.05, -24, -0.3, 0.6)
  cue(glock(96, 1.0), T.midnight + 0.25, -27, -0.2, 0.6)
  cue(jingle(5), T.rotate + 0.05, -20, 0.4, 0.3)
  sweep(whoosh(0.5, 900, 3000, 6, 1.4), T.rotate, -25, 0.2, 0.5)
  cue(slideWhistle(1.1, 79, 67), T.eventually - 0.05, -22, 0.4, 0.35)
  cue(scribble(0.7, 31, { center: 3800 }), T.eventually, -27, 0.4)
  // the session: a terminal slides in and starts racing
  sweep(whoosh(0.45, 400, 1500, 7), T.session, -22, -0.9, -0.4)
  cue(slap(8, 0.9), T.session + 0.42, -19, -0.5)
  cue(typing(1.5, 16, 9), T.session + 0.4, -29, -0.5, 0.05)
  // the gust
  sweep(whoosh(1.9, 160, 1800, 11, 0.6), T.gust - 0.3, -13, -0.8, 0.9, 0.3)
  sweep(whoosh(1.2, 600, 4200, 12, 0.8), T.gust + 0.15, -20, -0.6, 0.9, 0.2)
  const deskX: Record<string, number> = { bug: 470, key: 1450, task: 1530, tests: 330, deploy: 990 }
  Object.values(deskX).forEach((x, i) => {
    const t = HITS.detach(x)
    cue(pluck(86 + i * 2, 0.4, { bright: 0.9, decay: 0.12, seed: 50 + i }), t + 0.09, -23, px(x))
    sweep(rustle(0.7, 60 + i, 22), t, -21, px(x), 0.9)
  })
  // the rip
  sweep(tear(0.62, 13), T.rip - 0.02, -12, 0.6, -0.4, 0.2)
  cue(slap(14, 1.4), T.rip + 0.55, -24, 0, 0.2)

  // scene 2: the tags come back and get pinned
  sweep(whoosh(0.6, 700, 2400, 15), T.tagsBack, -21, 0.9, -0.2)
  T.pins.forEach((t, i) => {
    cue(thunk(20 + i), t, -8, [-0.5, 0, 0.5][i])
    cue(slap(23 + i, 0.6), t, -22, [-0.5, 0, 0.5][i])
  })
  cue(scribble(0.4, 32, { center: 2400, tone: 2100 }), T.sticky - 0.42, -24, -0.4)
  HITS.letters.forEach((t, i) => cue(slap(30 + i, 0.95 + (i % 3) * 0.1), t, -14 + (i % 2) * -2, (i < 6 ? (i - 2.5) / 6 : (i - 8) / 5) * 0.8, 0.2))
  cue(splash(1.2, 3), T.sticky, -27, 0, 0.3)
  const titleDone = HITS.letters[HITS.letters.length - 1]! + 0.15
  ;[91, 96, 100].forEach((m, i) => cue(glock(m, 1.1), titleDone + i * 0.06, -27, [-0.5, 0.5, 0.2][i], 0.6))
  sweep(whoosh(0.4, 600, 2600, 16, 1.2), T.subtitle - 0.3, -24, -0.4, 0.4)
  cue(scribble(1.35, 33, { center: 3400, rate: 10 }), T.subtitle, -25, 0)
  sweep(whoosh(1.0, 250, 900, 17, 0.7), T.toTerminal, -24, 0, 0)

  // scene 3: annotating the pane
  HITS.labels.forEach((t, i) => cue(slap(40 + i, 0.8), t + HITS.labelFall, -17, 0.6, 0.2))
  cue(scribble(0.55, 34, { center: 2300, rate: 4, tone: 2200 }), T.phase - 0.05, -22, 0.2)
  cue(scribble(0.4, 35, { center: 2300, rate: 4, tone: 2000 }), T.phase + 0.2, -25, 0.4)
  cue(scribble(0.5, 36, { center: 2300, rate: 5, tone: 2400 }), T.three - 0.05, -23, 0.2)
  for (const [t, s] of [[T.listAI, 37], [T.listYou, 38], [T.listBugs, 39]] as const) {
    cue(scribble(0.45, s, { center: 2300, rate: 4, tone: 2100 }), t - 0.05, -23, 0.1)
    cue(click(s), t - 0.05, -24, 0.25)
  }
  cue(click(40), T.current - 0.6, -26, 0.25)

  // scene 4: Claude at work
  for (const t of [T.files - 0.4, T.ticks - 0.3, T.nudge - 0.5]) cue(typing(0.3, 30, Math.round(t * 10)), t, -30, -0.3)
  sweep(whoosh(0.5, 500, 1500, 18), T.files - 0.55, -28, 0.6, 0.1)
  cue(scribble(0.55, 41, { center: 4600, rate: 12 }), T.files + 0.05, -18, 0.2)
  cue(boop(84), T.files + 0.06, -26, 0.3)
  cue(scribble(0.3, 42, { center: 4600, rate: 7 }), T.ticks, -25, 0.1)
  cue(glock(88, 1), T.ticks + 0.3, -24, 0.2, 0.5)
  cue(boop(79), T.ticks + 0.4, -27, 0.3)
  cue(bell(84, 1.6), T.nudge - 0.08, -17, -0.2, 0.5)
  cue(bell(91, 1.6), T.nudge + 0.06, -18, -0.2, 0.5)
  cue(boop(64), T.nudge + 0.1, -18, -0.3)
  cue(boop(62), T.nudge + 0.26, -20, -0.3)
  sweep(whoosh(0.45, 800, 2600, 19), T.lands - 0.18, -24, -0.3, 0.3)
  cue(pop(76, 43), T.lands + 0.22, -18, 0.3)

  // scene 5: you tick one off
  sweep(whoosh(0.6, 300, 1000, 20, 0.7), T.glance - 0.35, -27, 0.6, 0.2)
  cue(click(44), T.click, -13, 0.2)
  cue(scribble(0.35, 45, { center: 2600, rate: 6, tone: 2300 }), T.tick - 0.05, -17, 0.2)
  cue(glock(84, 1.4), T.tick + 0.08, -18, 0.2, 0.5)
  cue(glock(91, 1.4), T.tick + 0.16, -21, 0.3, 0.5)
  const r = rng(99)
  for (let i = 0; i < 12; i++) cue(pop(90 + Math.floor(r() * 8), 70 + i), T.tick + 0.1 + r() * 0.5, -31 - r() * 6, (r() - 0.5) * 1.2, 0.3)

  // scene 6: one board per project, one file
  sweep(whoosh(0.8, 250, 2200, 21, 0.6), T.tick + 0.85, -17, -0.6, 0.8)
  T.projects.forEach((t, i) => {
    cue(slap(50 + i, 1), t, -15, [-0.5, 0, 0.5][i], 0.2)
    cue(thunk(53 + i), t + 0.03, -12, [-0.5, 0, 0.5][i])
  })
  sweep(whoosh(0.45, 300, 1400, 22), T.file - 0.32, -22, 0, 0)
  cue(slap(56, 1.2), T.file + 0.1, -17)
  cue(typewriter(1.05, 57), T.file + 0.08, -22, 0.1, 0.1)
  cue(bell(96, 1.6), T.file + 1.2, -20, 0.4, 0.4)
  for (let i = 0; i < 3; i++) cue(scribble(0.3, 60 + i, { center: 1900, rate: 3 }), T.file + 0.45 + i * 0.16, -26, 0.1)
  cue(slap(63, 0.7), T.file + 1.62, -24, 0.3)

  // finale
  sweep(whoosh(1.0, 220, 1800, 23, 0.6), T.outro - 0.95, -18, 0.8, -0.3)
  for (let i = 0; i < HITS.letters.length; i++) cue(slap(70 + i, 0.8), HITS.hop(i) + 0.24, -19, ((i % 6) - 2.5) / 6, 0.2)
  sweep(whoosh(2.2, 200, 700, 24, 0.5), T.keep, -26, -0.2, 0.2, 0.3)
  sweep(whoosh(0.5, 500, 1800, 25), T.keep + 0.05, -23, 0, 0)
  cue(scribble(1.55, 64, { center: 3400, rate: 10 }), T.keep + 0.15, -24, 0)
  cue(slap(65, 1.1), T.endCard + 0.18, -15, 0, 0.2)
  cue(thunk(66), T.final - 0.01, -12, -0.5)
  cue(thunk(67), T.final + 0.05, -13, 0.5)
  ;[96, 100, 103].forEach((m, i) => cue(glock(m, 1.2), T.final + 0.05 + i * 0.07, -25, [-0.6, 0.6, 0][i], 0.6))

  return { dry, send }
}

// Instruments, all synthesised: plucked strings (Karplus-Strong), an upright
// bass, glockenspiel, a whistled lead, a soft pad and a small kit of percussion.

import { Biquad, SR, ad, filter, mtof, n, noise, rng, tail } from './dsp'

// Karplus-Strong plucked string. `bright` 0..1 shapes the pick, `decay` in seconds.
export function pluck(midi: number, dur: number, o: { bright?: number; decay?: number; seed?: number; body?: number } = {}) {
  const f = mtof(midi)
  const len = n(dur)
  const out = new Float32Array(len)
  const P = SR / f
  const r = rng(o.seed ?? midi * 7)
  const bright = o.bright ?? 0.6
  const s2 = 0.5 - bright * 0.2 // less averaging = brighter, longer highs
  // The averager mixes in the *next* sample, so the loop is N - s2 samples long
  // plus an allpass making up the fraction: N - s2 + d = P.
  const N = Math.max(2, Math.floor(P + s2 - 0.1))
  const d = P + s2 - N
  const C = (1 - d) / (1 + d)
  const line = new Float32Array(N)
  // a filtered noise burst as the pick
  let lp = 0
  for (let i = 0; i < N; i++) {
    lp += (r() * 2 - 1 - lp) * (0.2 + bright * 0.75)
    line[i] = lp
  }
  const loss = Math.exp(-1 / ((o.decay ?? 1.2) * f))
  let apX = 0
  let apY = 0
  let idx = 0
  for (let i = 0; i < len; i++) {
    const cur = line[idx]!
    const nxt = line[(idx + 1) % N]!
    const v = (cur * (1 - s2) + nxt * s2) * loss
    const ap = C * v + apX - C * apY
    apX = v
    apY = ap
    line[idx] = ap
    out[i] = cur
    idx = (idx + 1) % N
  }
  if (o.body !== 0) {
    // a small resonant body
    const body = new Biquad('peak', 220, 1.2, 4)
    const air = new Biquad('highshelf', 3500, 0.7, -4 + bright * 4)
    for (let i = 0; i < len; i++) out[i] = air.tick(body.tick(out[i]!))
  }
  return tail(out, 0.03)
}

// Upright bass: a softer pluck plus a sine fundamental for weight.
export function bass(midi: number, dur: number, seed = 1) {
  const f = mtof(midi)
  const out = pluck(midi, dur, { bright: 0.18, decay: 1.6, seed, body: 0 })
  filter(out, 'lp', 900, 0.7)
  for (let i = 0; i < out.length; i++) {
    const t = i / SR
    const env = Math.min(1, t / 0.006) * Math.exp(-t / 0.7)
    out[i] = out[i]! * 0.8 + Math.sin(2 * Math.PI * f * t) * env * 0.55
  }
  return tail(out, 0.05)
}

// Glockenspiel: inharmonic bar partials with a tiny mallet click.
export function glock(midi: number, dur = 1.6, seed = 1) {
  const f = mtof(midi)
  const len = n(dur)
  const out = new Float32Array(len)
  const partials: [number, number, number][] = [
    [1, 1, 1.4],
    [2.756, 0.38, 0.45],
    [5.404, 0.16, 0.18],
    [8.933, 0.06, 0.08],
  ]
  for (const [ratio, amp, dec] of partials) {
    const fr = f * ratio
    if (fr > SR * 0.45) continue
    for (let i = 0; i < len; i++) {
      const t = i / SR
      out[i]! += Math.sin(2 * Math.PI * fr * t) * amp * Math.exp(-t / dec) * Math.min(1, t / 0.0015)
    }
  }
  const click = ad(noise(n(0.008), seed), 0.0005, 0.002)
  filter(click, 'hp', 3000)
  for (let i = 0; i < click.length; i++) out[i]! += click[i]! * 0.25
  return tail(out, 0.05)
}

// Celesta-ish soft bell for chimes.
export function bell(midi: number, dur = 1.8) {
  const f = mtof(midi)
  const len = n(dur)
  const out = new Float32Array(len)
  const partials: [number, number, number][] = [[1, 1, 1.1], [2, 0.5, 0.6], [3.01, 0.22, 0.35], [4.2, 0.12, 0.2], [5.43, 0.06, 0.12]]
  for (const [ratio, amp, dec] of partials)
    for (let i = 0; i < len; i++) {
      const t = i / SR
      out[i]! += Math.sin(2 * Math.PI * f * ratio * t) * amp * Math.exp(-t / dec) * Math.min(1, t / 0.002)
    }
  return tail(out, 0.05)
}

// A whistled melody: notes glide into each other, vibrato blooms, breath noise.
export function whistle(notes: { t: number; d: number; m: number }[], total: number, seed = 3) {
  const len = n(total)
  const out = new Float32Array(len)
  const breath = filter(noise(len, seed), 'bp', 2000, 0.7)
  let phase = 0
  let freq = mtof(notes[0]!.m - 1)
  for (let i = 0; i < len; i++) {
    const t = i / SR
    const cur = notes.find(x => t >= x.t && t < x.t + x.d)
    let amp = 0
    if (cur) {
      const since = t - cur.t
      const until = cur.t + cur.d - t
      const target = mtof(cur.m)
      freq += (target - freq) * (since < 0.06 ? 0.004 : 0.02)
      const vib = 1 + 0.006 * Math.sin(2 * Math.PI * 5.6 * t) * Math.min(1, Math.max(0, since - 0.12) / 0.25)
      amp = Math.min(1, since / 0.035) * Math.min(1, until / 0.05)
      phase += (2 * Math.PI * freq * vib) / SR
    }
    out[i] = (Math.sin(phase) * 0.9 + Math.sin(phase * 2) * 0.06) * amp + breath[i]! * amp * 0.05
  }
  return out
}

// A warm pad: detuned saws through a soft low-pass, slow swell.
export function pad(midis: number[], dur: number, o: { attack?: number; release?: number; cutoff?: number } = {}) {
  const len = n(dur)
  const out = new Float32Array(len)
  const att = o.attack ?? 0.6
  const rel = o.release ?? 0.8
  for (const m of midis) {
    for (const det of [-0.08, 0, 0.07]) {
      const f = mtof(m + det)
      let ph = rng(m * 13 + det * 100)()
      for (let i = 0; i < len; i++) {
        ph += f / SR
        ph -= Math.floor(ph)
        out[i]! += (ph * 2 - 1) * 0.2
      }
    }
  }
  const lp = new Biquad('lp', o.cutoff ?? 1100, 0.5)
  const lp2 = new Biquad('lp', o.cutoff ?? 1100, 0.5)
  for (let i = 0; i < len; i++) {
    const t = i / SR
    const env = Math.min(1, t / att) * Math.min(1, (dur - t) / rel)
    out[i] = lp2.tick(lp.tick(out[i]!)) * env
  }
  return out
}

export function kick(gain = 1) {
  const len = n(0.45)
  const out = new Float32Array(len)
  let ph = 0
  for (let i = 0; i < len; i++) {
    const t = i / SR
    const f = 46 + 110 * Math.exp(-t / 0.035)
    ph += (2 * Math.PI * f) / SR
    out[i] = Math.sin(ph) * Math.exp(-t / 0.2) * Math.min(1, t / 0.002) * gain
  }
  const click = ad(filter(noise(n(0.01), 9), 'hp', 1500), 0.0005, 0.003)
  for (let i = 0; i < click.length; i++) out[i]! += click[i]! * 0.3 * gain
  return out
}

// A finger snap: a tight band of noise with a little tonal knock.
export function snap(seed = 1, gain = 1) {
  const len = n(0.16)
  const out = filter(noise(len, seed), 'bp', 2600, 1.6)
  ad(out, 0.0008, 0.028)
  for (let i = 0; i < len; i++) {
    const t = i / SR
    out[i]! += Math.sin(2 * Math.PI * 1400 * t) * Math.exp(-t / 0.012) * 0.25
    out[i]! *= gain * 1.6
  }
  return out
}

export function shaker(seed = 1, gain = 1, accent = false) {
  const len = n(0.09)
  const out = filter(filter(noise(len, seed), 'hp', 5500, 0.7), 'peak', 9000, 1, 3)
  const a = n(accent ? 0.012 : 0.02)
  for (let i = 0; i < len; i++) {
    const env = i < a ? i / a : Math.exp(-(i - a) / (SR * (accent ? 0.025 : 0.018)))
    out[i]! *= env * gain
  }
  return out
}

// Soft brush on a snare.
export function brush(seed = 1, gain = 1, length = 0.22) {
  const len = n(length)
  const out = filter(filter(noise(len, seed), 'bp', 3200, 0.6), 'hp', 900)
  for (let i = 0; i < len; i++) {
    const t = i / SR
    out[i]! *= Math.min(1, t / 0.006) * Math.exp(-t / (length * 0.35)) * gain
  }
  return out
}

// Rising filtered noise into a big moment.
export function riser(dur: number, seed = 5) {
  const len = n(dur)
  const out = noise(len, seed)
  const bp = new Biquad('bp', 400, 1.2)
  for (let i = 0; i < len; i++) {
    const k = i / len
    if (i % 64 === 0) bp.set('bp', 300 + 5000 * k * k, 1.4)
    out[i] = bp.tick(out[i]!) * k * k * 1.4
  }
  return out
}

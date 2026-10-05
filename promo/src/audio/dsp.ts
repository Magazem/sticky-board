// A small DSP kit: stereo buses, filters, envelopes, a Freeverb-style reverb and
// WAV files in and out. Everything is plain Float32Array maths.

import fs from 'node:fs'

export const SR = 48000

export class Bus {
  readonly L: Float32Array
  readonly R: Float32Array
  constructor(readonly length: number) {
    this.L = new Float32Array(length)
    this.R = new Float32Array(length)
  }

  // Equal-power pan, pan in [-1, 1].
  add(mono: Float32Array, at: number, gain = 1, pan = 0) {
    const start = Math.round(at * SR)
    const a = ((pan + 1) * Math.PI) / 4
    const gl = Math.cos(a) * gain * Math.SQRT2
    const gr = Math.sin(a) * gain * Math.SQRT2
    for (let i = 0; i < mono.length; i++) {
      const j = start + i
      if (j < 0) continue
      if (j >= this.length) break
      this.L[j]! += mono[i]! * gl
      this.R[j]! += mono[i]! * gr
    }
  }

  // A sound that travels across the stereo field (pan from → to).
  addMoving(mono: Float32Array, at: number, gain: number, from: number, to: number) {
    const start = Math.round(at * SR)
    for (let i = 0; i < mono.length; i++) {
      const j = start + i
      if (j < 0) continue
      if (j >= this.length) break
      const pan = from + (to - from) * (i / mono.length)
      const a = ((pan + 1) * Math.PI) / 4
      this.L[j]! += mono[i]! * Math.cos(a) * gain * Math.SQRT2
      this.R[j]! += mono[i]! * Math.sin(a) * gain * Math.SQRT2
    }
  }

  mix(other: Bus, gain = 1) {
    for (let i = 0; i < this.length; i++) {
      this.L[i]! += other.L[i]! * gain
      this.R[i]! += other.R[i]! * gain
    }
  }
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

export const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12)
export const db = (d: number) => 10 ** (d / 20)
export const n = (seconds: number) => Math.max(1, Math.round(seconds * SR))

export function noise(len: number, seed: number) {
  const r = rng(seed)
  const out = new Float32Array(len)
  for (let i = 0; i < len; i++) out[i] = r() * 2 - 1
  return out
}

// RBJ biquad.
export class Biquad {
  private b0 = 1
  private b1 = 0
  private b2 = 0
  private a1 = 0
  private a2 = 0
  private x1 = 0
  private x2 = 0
  private y1 = 0
  private y2 = 0

  constructor(type: 'lp' | 'hp' | 'bp' | 'peak' | 'lowshelf' | 'highshelf', freq: number, q = 0.707, gainDb = 0) {
    this.set(type, freq, q, gainDb)
  }

  set(type: 'lp' | 'hp' | 'bp' | 'peak' | 'lowshelf' | 'highshelf', freq: number, q = 0.707, gainDb = 0) {
    const w = (2 * Math.PI * Math.min(freq, SR * 0.45)) / SR
    const cos = Math.cos(w)
    const sin = Math.sin(w)
    const alpha = sin / (2 * q)
    const A = 10 ** (gainDb / 40)
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number
    switch (type) {
      case 'lp':
        b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha
        break
      case 'hp':
        b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha
        break
      case 'bp':
        b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha
        break
      case 'peak':
        b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A
        break
      case 'lowshelf': {
        const s = 2 * Math.sqrt(A) * alpha
        b0 = A * (A + 1 - (A - 1) * cos + s); b1 = 2 * A * (A - 1 - (A + 1) * cos); b2 = A * (A + 1 - (A - 1) * cos - s)
        a0 = A + 1 + (A - 1) * cos + s; a1 = -2 * (A - 1 + (A + 1) * cos); a2 = A + 1 + (A - 1) * cos - s
        break
      }
      case 'highshelf': {
        const s = 2 * Math.sqrt(A) * alpha
        b0 = A * (A + 1 + (A - 1) * cos + s); b1 = -2 * A * (A - 1 + (A + 1) * cos); b2 = A * (A + 1 + (A - 1) * cos - s)
        a0 = A + 1 - (A - 1) * cos + s; a1 = 2 * (A - 1 - (A + 1) * cos); a2 = A + 1 - (A - 1) * cos - s
        break
      }
    }
    this.b0 = b0 / a0
    this.b1 = b1 / a0
    this.b2 = b2 / a0
    this.a1 = a1 / a0
    this.a2 = a2 / a0
  }

  tick(x: number) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2
    this.x2 = this.x1
    this.x1 = x
    this.y2 = this.y1
    this.y1 = y
    return y
  }

  run(buf: Float32Array) {
    for (let i = 0; i < buf.length; i++) buf[i] = this.tick(buf[i]!)
    return buf
  }
}

export const filter = (buf: Float32Array, type: ConstructorParameters<typeof Biquad>[0], f: number, q = 0.707, g = 0) =>
  new Biquad(type, f, q, g).run(buf)

// Attack/decay envelope in place: linear attack, exponential decay (time constant).
export function ad(buf: Float32Array, attack: number, decay: number) {
  const na = Math.max(1, attack * SR)
  for (let i = 0; i < buf.length; i++) {
    const a = i < na ? i / na : 1
    buf[i]! *= a * Math.exp(-Math.max(0, i - na) / (decay * SR))
  }
  return buf
}

// Fade the last `t` seconds to zero (clean note ends).
export function tail(buf: Float32Array, t = 0.02) {
  const m = Math.min(buf.length, n(t))
  for (let i = 0; i < m; i++) buf[buf.length - 1 - i]! *= i / m
  return buf
}

export function scale(buf: Float32Array, g: number) {
  for (let i = 0; i < buf.length; i++) buf[i]! *= g
  return buf
}

export function addInto(dst: Float32Array, src: Float32Array, offset = 0, g = 1) {
  for (let i = 0; i < src.length && i + offset < dst.length; i++) if (i + offset >= 0) dst[i + offset]! += src[i]! * g
  return dst
}

// Freeverb-style stereo reverb.
export function reverb(input: Bus, o: { room?: number; damp?: number; wet?: number; predelay?: number } = {}) {
  const room = o.room ?? 0.82
  const damp = o.damp ?? 0.35
  const k = SR / 44100
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map(c => Math.round(c * k))
  const alls = [556, 441, 341, 225].map(c => Math.round(c * k))
  const spread = Math.round(23 * k)
  const pre = Math.round((o.predelay ?? 0.012) * SR)
  const out = new Bus(input.length)
  for (const [src, dst, off] of [[input.L, out.L, 0], [input.R, out.R, spread]] as const) {
    const cb = combs.map(c => ({ buf: new Float32Array(c + off), i: 0, store: 0 }))
    const ab = alls.map(c => ({ buf: new Float32Array(c + off), i: 0 }))
    for (let s = 0; s < src.length; s++) {
      const x = (s >= pre ? src[s - pre]! : 0) * 0.015
      let y = 0
      for (const c of cb) {
        const v = c.buf[c.i]!
        c.store = v * (1 - damp) + c.store * damp
        c.buf[c.i] = x + c.store * room
        c.i = (c.i + 1) % c.buf.length
        y += v
      }
      for (const a of ab) {
        const v = a.buf[a.i]!
        a.buf[a.i] = y + v * 0.5
        a.i = (a.i + 1) % a.buf.length
        y = v - y
      }
      dst[s] = y * (o.wet ?? 1)
    }
  }
  return out
}

// --- WAV ---

export function readWav(file: string): { data: Float32Array; rate: number } {
  const b = fs.readFileSync(file)
  let p = 12
  let fmt = 1
  let ch = 1
  let rate = SR
  let bits = 16
  while (p < b.length) {
    const id = b.toString('ascii', p, p + 4)
    const size = b.readUInt32LE(p + 4)
    if (id === 'fmt ') {
      fmt = b.readUInt16LE(p + 8)
      ch = b.readUInt16LE(p + 10)
      rate = b.readUInt32LE(p + 12)
      bits = b.readUInt16LE(p + 22)
      // WAVE_FORMAT_EXTENSIBLE keeps the real format in its sub-format GUID
      if (fmt === 0xfffe) fmt = b.readUInt16LE(p + 8 + 24)
    } else if (id === 'data') {
      if (fmt !== 1 && fmt !== 3) throw new Error(`unsupported wav format ${fmt} in ${file}`)
      const frames = size / (bits / 8) / ch
      const data = new Float32Array(frames)
      for (let i = 0; i < frames; i++) {
        let v = 0
        for (let c = 0; c < ch; c++) {
          const at = p + 8 + (i * ch + c) * (bits / 8)
          if (fmt === 3) v += bits === 64 ? b.readDoubleLE(at) : b.readFloatLE(at)
          else if (bits === 24) v += b.readIntLE(at, 3) / 8388608
          else if (bits === 32) v += b.readInt32LE(at) / 2147483648
          else v += b.readInt16LE(at) / 32768
        }
        data[i] = v / ch
      }
      return { data, rate }
    }
    p += 8 + size + (size % 2)
  }
  throw new Error(`no data chunk in ${file}`)
}

export function writeWav(file: string, bus: Bus) {
  const len = bus.length
  const b = Buffer.alloc(44 + len * 8)
  b.write('RIFF', 0)
  b.writeUInt32LE(36 + len * 8, 4)
  b.write('WAVE', 8)
  b.write('fmt ', 12)
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(3, 20)
  b.writeUInt16LE(2, 22)
  b.writeUInt32LE(SR, 24)
  b.writeUInt32LE(SR * 8, 28)
  b.writeUInt16LE(8, 32)
  b.writeUInt16LE(32, 34)
  b.write('data', 36)
  b.writeUInt32LE(len * 8, 40)
  for (let i = 0; i < len; i++) {
    b.writeFloatLE(bus.L[i]!, 44 + i * 8)
    b.writeFloatLE(bus.R[i]!, 48 + i * 8)
  }
  fs.writeFileSync(file, b)
}

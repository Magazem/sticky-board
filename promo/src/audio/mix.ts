// Mixes narration, music and foley into build/audio.wav.
// The music ducks under the voice (with a little lookahead), everything shares a
// room, and the master is limited and loudness-normalised to -14 LUFS.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { DURATION, T, voice } from '../shared/timeline'
import { Biquad, Bus, SR, db, readWav, reverb, writeWav } from './dsp'
import { renderMusic } from './music'
import { renderSfx } from './sfx'

const root = path.resolve(import.meta.dirname, '../..')
const build = path.join(root, 'build')
fs.mkdirSync(path.join(build, 'vo48'), { recursive: true })
fs.mkdirSync(path.join(build, 'stems'), { recursive: true })

const LEN = Math.ceil(DURATION * SR)
const rms = (b: Bus, from = 0, to = b.length) => {
  let s = 0
  for (let i = from; i < to; i++) s += (b.L[i]! ** 2 + b.R[i]! ** 2) / 2
  return 20 * Math.log10(Math.sqrt(s / Math.max(1, to - from)) + 1e-12)
}
const peak = (b: Bus) => {
  let p = 0
  for (let i = 0; i < b.length; i++) p = Math.max(p, Math.abs(b.L[i]!), Math.abs(b.R[i]!))
  return 20 * Math.log10(p + 1e-12)
}

// --- narration ---
function narration() {
  const bus = new Bus(LEN)
  for (const line of voice) {
    const src = path.join(root, 'assets', line.file)
    const dst = path.join(build, 'vo48', path.basename(line.file))
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-af', 'aresample=48000:resampler=soxr:precision=28', '-c:a', 'pcm_f32le', dst])
    const { data } = readWav(dst)
    // light polish: clear the rumble, a touch of presence and air
    const chain = [
      new Biquad('hp', 80, 0.7),
      new Biquad('peak', 260, 1.0, -1.5),
      new Biquad('peak', 3400, 0.9, 2.2),
      new Biquad('highshelf', 9000, 0.7, 1.5),
    ]
    for (let i = 0; i < data.length; i++) {
      let x = data[i]!
      for (const f of chain) x = f.tick(x)
      data[i] = x
    }
    bus.add(data, line.start, 1, 0)
  }
  // even the lines out: a smooth compressor, then a limiter on the plosives
  const level = speechRms(bus)
  compress(bus, { threshold: level + 1, ratio: 3, attack: 0.004, release: 0.12 })
  limit(bus, speechRms(bus) + 10, 0.003, 0.05)
  return bus
}

// Ducking gain from the voice's envelope, applied a little ahead of each word.
function duckCurve(vo: Bus, depthDb: number) {
  const env = new Float32Array(LEN)
  let e = 0
  for (let i = 0; i < LEN; i++) {
    const x = Math.abs(vo.L[i]!)
    e = x > e ? e + (x - e) * 0.01 : e + (x - e) * 0.00012
    env[i] = e
  }
  const ahead = Math.round(0.08 * SR)
  const out = new Float32Array(LEN)
  const floor = db(depthDb)
  let g = 1
  for (let i = 0; i < LEN; i++) {
    const v = env[Math.min(LEN - 1, i + ahead)]!
    const target = 1 - (1 - floor) * Math.min(1, v / 0.03)
    g = target < g ? g + (target - g) * 0.0009 : g + (target - g) * 0.00008
    out[i] = g
  }
  return out
}

function applyGain(b: Bus, curve: Float32Array) {
  for (let i = 0; i < b.length; i++) {
    b.L[i]! *= curve[i]!
    b.R[i]! *= curve[i]!
  }
}

// The music swells where the story lets it breathe: the opening bars, the
// build into the finale, and the finale itself once the voice is done.
function automation() {
  const moves: [number, number, number, number][] = [
    // from, to, ramp, dB
    [0, 1.05, 0.15, 3],
    [41.9, 43.2, 0.3, 3],
    [46.05, 51, 0.6, 5],
  ]
  const out = new Float32Array(LEN)
  for (let i = 0; i < LEN; i++) {
    const t = i / SR
    let d = 0
    for (const [a, b, r, g] of moves) {
      const k = Math.min(1, Math.max(0, (t - a) / r), Math.max(0, (b - t) / r))
      d += g * k
    }
    out[i] = db(d)
  }
  return out
}

// RMS (dB) of a bus over the stretches where it is clearly active.
function speechRms(b: Bus) {
  const w = Math.round(0.05 * SR)
  const levels: number[] = []
  for (let i = 0; i + w < b.length; i += w) {
    let e = 0
    for (let j = i; j < i + w; j++) e += b.L[j]! ** 2
    levels.push(10 * Math.log10(e / w + 1e-20))
  }
  const loud = Math.max(...levels)
  const active = levels.filter(l => l > loud - 25)
  return 10 * Math.log10(active.reduce((n, l) => n + 10 ** (l / 10), 0) / active.length)
}

// Feed-forward compressor with a smoothed RMS detector (dB in, gain out).
function compress(b: Bus, o: { threshold: number; ratio: number; attack: number; release: number }) {
  const at = Math.exp(-1 / (o.attack * SR))
  const rl = Math.exp(-1 / (o.release * SR))
  const det = Math.exp(-1 / (0.005 * SR))
  let p = 0
  let gr = 0
  for (let i = 0; i < b.length; i++) {
    const x = (b.L[i]! ** 2 + b.R[i]! ** 2) / 2
    p = det * p + (1 - det) * x
    const lvl = 10 * Math.log10(p + 1e-20)
    const want = lvl > o.threshold ? (lvl - o.threshold) * (1 - 1 / o.ratio) : 0
    gr = want > gr ? at * gr + (1 - at) * want : rl * gr + (1 - rl) * want
    const g = db(-gr)
    b.L[i]! *= g
    b.R[i]! *= g
  }
}

// Lookahead limiter: the gain starts easing down `look` seconds before a peak
// and is guaranteed under the ceiling at the peak (min-hold, then averaging).
function limit(b: Bus, ceilingDb: number, look = 0.004, release = 0.06) {
  const ceil = db(ceilingDb)
  const L = Math.max(1, Math.round(look * SR))
  const len = b.length
  const need = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    const p = Math.max(Math.abs(b.L[i]!), Math.abs(b.R[i]!))
    need[i] = p > ceil ? ceil / p : 1
  }
  // forward min over the next L samples (monotonic deque)
  const hold = new Float32Array(len)
  const dq: number[] = []
  let head = 0
  for (let i = len - 1; i >= 0; i--) {
    while (dq.length > head && need[dq[dq.length - 1]!]! >= need[i]!) dq.pop()
    dq.push(i)
    while (dq[head]! > i + L) head++
    hold[i] = need[dq[head]!]!
  }
  // release smoothing, then a moving average over L
  const rl = Math.exp(-1 / (release * SR))
  let env = 1
  for (let i = 0; i < len; i++) {
    env = hold[i]! < env ? hold[i]! : rl * env + (1 - rl) * hold[i]!
    hold[i] = env
  }
  let acc = 0
  const g = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    acc += hold[i]!
    if (i >= L) acc -= hold[i - L]!
    g[i] = Math.min(hold[i]!, acc / Math.min(i + 1, L))
  }
  // delay the audio by L so the gain leads the peaks
  for (const ch of [b.L, b.R]) {
    for (let i = len - 1; i >= 0; i--) ch[i] = i >= L ? ch[i - L]! : 0
    for (let i = 0; i < len; i++) ch[i]! *= g[Math.min(len - 1, i)]!
  }
}

function lufs(b: Bus) {
  const f = path.join(build, 'measure.wav')
  writeWav(f, b)
  const out = execFileSync('sh', ['-c', `ffmpeg -hide_banner -nostats -i "${f}" -af ebur128=peak=true -f null - 2>&1`], { encoding: 'utf8' })
  const i = out.lastIndexOf('Integrated loudness')
  return Number(/I:\s+(-?[\d.]+) LUFS/.exec(out.slice(i))![1])
}

const vo = narration()
const music = renderMusic(LEN)
const sfx = renderSfx(LEN)

// one shared room for music and foley, a smaller one for the voice
const roomIn = new Bus(LEN)
roomIn.mix(music.send)
roomIn.mix(sfx.send)
const room = reverb(roomIn, { room: 0.84, damp: 0.38, wet: 1, predelay: 0.018 })
const voRoom = reverb(vo, { room: 0.55, damp: 0.5, wet: 0.09, predelay: 0.008 })

const musicBus = new Bus(LEN)
musicBus.mix(music.dry)
musicBus.mix(room, 0.55)
const sfxBus = new Bus(LEN)
sfxBus.mix(sfx.dry)
sfxBus.mix(room, 0.0)

const VO_GAIN = Number(process.env.VO_GAIN ?? 0)
const MUSIC_GAIN = Number(process.env.MUSIC_GAIN ?? -10)
const SFX_GAIN = Number(process.env.SFX_GAIN ?? -4)
// keep the low end light: no sub-rumble, a little less boom
{
  const chainL = [new Biquad('hp', 38, 0.7), new Biquad('lowshelf', 110, 0.7, -2.5)]
  const chainR = [new Biquad('hp', 38, 0.7), new Biquad('lowshelf', 110, 0.7, -2.5)]
  for (let i = 0; i < LEN; i++) {
    let l = musicBus.L[i]!
    let r = musicBus.R[i]!
    for (const f of chainL) l = f.tick(l)
    for (const f of chainR) r = f.tick(r)
    musicBus.L[i] = l
    musicBus.R[i] = r
  }
}
// shave the kick and bass transients so the master limiter has little to do
limit(musicBus, peak(musicBus) - 6, 0.004, 0.05)
applyGain(musicBus, duckCurve(vo, -12))
applyGain(sfxBus, duckCurve(vo, -5))
applyGain(musicBus, automation())

const master = new Bus(LEN)
master.mix(vo, db(VO_GAIN))
master.mix(voRoom, db(VO_GAIN))
master.mix(musicBus, db(MUSIC_GAIN))
master.mix(sfxBus, db(SFX_GAIN))

// fades
const fadeIn = Math.round(0.05 * SR)
const f0 = Math.round(T.fadeOut * SR)
for (let i = 0; i < LEN; i++) {
  let g = i < fadeIn ? i / fadeIn : 1
  if (i > f0) g *= Math.max(0, 1 - (i - f0) / (LEN - f0)) ** 1.5
  master.L[i]! *= g
  master.R[i]! *= g
}
// Loudness: gain to -14 LUFS, limit the peaks, and once more to make up for
// what the limiter took.
for (let pass = 0; pass < 2; pass++) {
  const g = db(-14 - lufs(master))
  for (let i = 0; i < LEN; i++) {
    master.L[i]! *= g
    master.R[i]! *= g
  }
  limit(master, -1.6, 0.004, 0.08)
}
const finalLufs = lufs(master)

// stems at their mix levels, for checking the balance
const stem = (name: string, b: Bus, g: number) => {
  const c = new Bus(LEN)
  c.mix(b, db(g))
  writeWav(path.join(build, 'stems', `${name}.wav`), c)
  console.log(`${name.padEnd(6)} rms ${rms(c).toFixed(1)} dB  peak ${peak(c).toFixed(1)} dB`)
}
stem('voice', vo, VO_GAIN)
stem('music', musicBus, MUSIC_GAIN)
stem('sfx', sfxBus, SFX_GAIN)

// 16-bit with a little TPDF dither
const r = (() => { let s = 7; return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) })()
const pcm = Buffer.alloc(44 + LEN * 4)
pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + LEN * 4, 4); pcm.write('WAVE', 8); pcm.write('fmt ', 12)
pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(2, 22); pcm.writeUInt32LE(SR, 24)
pcm.writeUInt32LE(SR * 4, 28); pcm.writeUInt16LE(4, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(LEN * 4, 40)
for (let i = 0; i < LEN; i++) {
  for (const [c, ch] of [[0, master.L], [1, master.R]] as const) {
    const v = Math.max(-32768, Math.min(32767, Math.round(ch[i]! * 32767 + (r() - r()))))
    pcm.writeInt16LE(v, 44 + i * 4 + c * 2)
  }
}
fs.writeFileSync(path.join(build, 'audio.wav'), pcm)
console.log(`master ${finalLufs} LUFS, peak ${peak(master).toFixed(2)} dBFS → build/audio.wav`)

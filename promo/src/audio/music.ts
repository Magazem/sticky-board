// The score: a light ukulele-and-glockenspiel groove at 100 BPM, arranged around
// the narration. Melody lives in the gaps between lines; the groove holds still
// under the voice; the big moments (gust, pins, title, finale) land on the grid.

import { BEAT, T } from '../shared/timeline'
import { Bus, db } from './dsp'
import { bass, brush, glock, kick, pad, pluck, riser, shaker, snap, whistle } from './instruments'

type Chord = { uke: number[]; root: number; fifth: number }
const CH: Record<string, Chord> = {
  C: { uke: [60, 64, 67, 72], root: 36, fifth: 43 },
  Am: { uke: [57, 60, 64, 69], root: 45, fifth: 40 },
  F: { uke: [57, 60, 65, 69], root: 41, fifth: 48 },
  G: { uke: [55, 59, 62, 67], root: 43, fifth: 38 },
  Dm: { uke: [57, 62, 65, 69], root: 38, fifth: 45 },
  G7: { uke: [55, 59, 65, 67], root: 43, fifth: 38 },
  Gsus: { uke: [55, 60, 62, 67], root: 43, fifth: 38 },
}

// one chord per bar (bar 4 and the outro bars split in two)
const BARS: Record<number, [string, string?]> = {
  0: ['C'], 1: ['Am'], 2: ['F'], 3: ['G'], 4: ['Dm', 'G7'],
  6: ['C'], 7: ['G'], 8: ['Am'], 9: ['F'], 10: ['C'], 11: ['G'], 12: ['F'], 13: ['G'],
  14: ['Am'], 15: ['F'], 16: ['Dm'], 17: ['Gsus', 'G'],
  18: ['C', 'Am'], 19: ['F', 'G'],
}

const chordAt = (beat: number) => {
  const bar = Math.floor(beat / 4)
  const c = BARS[bar]
  if (!c) return null
  return CH[(c[1] && beat % 4 >= 2 ? c[1] : c[0])!]!
}

export function renderMusic(length: number) {
  const dry = new Bus(length)
  const send = new Bus(length) // to the reverb
  const at = (beat: number) => beat * BEAT
  const put = (buf: Float32Array, beat: number, gainDb: number, pan: number, wet: number) => {
    dry.add(buf, at(beat), db(gainDb), pan)
    if (wet > 0) send.add(buf, at(beat), db(gainDb) * wet, pan)
  }

  // ukulele strum: notes staggered a few ms, up-strums reversed and lighter
  const strum = (beat: number, chord: Chord, gainDb: number, up = false, decay = 0.9) => {
    const notes = up ? chord.uke.slice().reverse().slice(0, 3) : chord.uke
    notes.forEach((m, i) => {
      const buf = pluck(m, decay + 0.4, { bright: up ? 0.5 : 0.62, decay, seed: Math.round(beat * 97) + i })
      dry.add(buf, at(beat) + i * 0.011, db(gainDb - (up ? 4 : 0) - i * 0.6), -0.25)
      send.add(buf, at(beat) + i * 0.011, db(gainDb - 9), -0.25)
    })
  }
  const bassNote = (beat: number, midi: number, gainDb = -6, dur = 0.9) => put(bass(midi, dur, Math.round(beat * 13)), beat, gainDb, 0, 0.08)
  const bell = (beat: number, midi: number, gainDb = -17) => put(glock(midi, 1.8, Math.round(beat * 7)), beat, gainDb, 0.32, 0.45)
  const k = (beat: number, g = -5) => put(kick(), beat, g, 0, 0.05)
  const sn = (beat: number, g = -15) => put(snap(Math.round(beat * 11)), beat, g, -0.2, 0.25)
  const sh = (beat: number, g = -24, accent = false) => put(shaker(Math.round(beat * 17), 1, accent), beat, g, 0.38, 0.1)
  const br = (beat: number, g = -18) => put(brush(Math.round(beat * 19)), beat, g, 0.15, 0.15)

  // --- A: curious (bars 0-4, beats 0-20) ---
  for (let bar = 0; bar <= 3; bar++) {
    const b0 = bar * 4
    const c = chordAt(b0)!
    bassNote(b0, c.root, -7, 0.55)
    bassNote(b0 + 2, c.fifth, -9, 0.5)
    strum(b0 + 1, c, -15, false, 0.35)
    strum(b0 + 3, c, -16, false, 0.35)
    if (bar >= 1) for (let e = 0; e < 8; e++) sh(b0 + e / 2, e % 2 ? -25 : -29, e % 2 === 1)
    if (bar >= 2) {
      k(b0, -9)
      k(b0 + 2, -10)
    }
  }
  // bar 4: everything climbs toward the gust
  ;[38, 41, 45, 50, 43, 47, 50, 53].forEach((m, i) => bassNote(16 + i / 2, m, -8 + i * 0.3, 0.32))
  for (let e = 0; e < 8; e++) {
    strum(16 + e / 2 + 0.25, chordAt(16 + e / 2)!, -21 + e * 0.8, e % 2 === 1, 0.22)
    br(16 + e / 2, -24 + e * 1.1)
    sh(16 + e / 2, -24, true)
  }
  for (let q = 0; q < 4; q++) k(16 + q, -8)
  put(riser(at(3)), 17, -16, 0, 0.3)
  // glockenspiel in the gaps of the opening lines
  ;[[0, 67], [0.5, 72], [1, 76], [1.5, 79]].forEach(([b, m]) => bell(b!, m!, -15))
  ;[[5, 69], [5.5, 72]].forEach(([b, m]) => bell(b!, m!, -18))
  bell(11.75, 76, -19)
  ;[[17, 74], [17.25, 77], [17.5, 81]].forEach(([b, m]) => bell(b!, m!, -20))

  // --- break: the gust, the rip, the pins (beats 20-24) ---
  put(pad([48, 55, 60], at(3.6), { attack: 0.9, release: 0.6, cutoff: 700 }), 20.4, -22, 0, 0.6)
  bassNote(23, 43, -6, 0.4)
  bassNote(23.5, 43, -6, 0.4)
  bell(23, 67, -16)
  bell(23.5, 71, -16)

  // --- B: the groove (bars 6-17, beats 24-72) ---
  for (let bar = 6; bar <= 17; bar++) {
    const b0 = bar * 4
    const c = chordAt(b0)!
    const light = bar === 14 || bar === 15
    const build = bar === 17
    // bass: root, fifth, a step into the next bar
    bassNote(b0, c.root, -5, 0.95)
    bassNote(b0 + 2, c.fifth, -7, 0.85)
    const next = chordAt(b0 + 4)
    if (next && !build) bassNote(b0 + 3.5, next.root + (next.root > c.root ? -1 : 2), -10, 0.4)
    // uke: D - D U - U D U
    if (!build) {
      strum(b0, c, -13)
      strum(b0 + 1, c, -17, false, 0.5)
      strum(b0 + 1.5, c, -18, true, 0.4)
      strum(b0 + 2.5, c, -18, true, 0.4)
      strum(b0 + 3, c, -16, false, 0.5)
      strum(b0 + 3.5, c, -19, true, 0.35)
    } else {
      for (let e = 0; e < 8; e++) strum(b0 + e / 2, chordAt(b0 + e / 2)!, -19 + e * 0.9, e % 2 === 1, 0.3)
    }
    // drums
    if (!build) {
      k(b0, -6)
      k(b0 + 2, -7)
      if (bar % 2 === 1) k(b0 + 2.5, -12)
      if (!light) {
        sn(b0 + 1)
        sn(b0 + 3)
      }
      for (let e = 0; e < 8; e++) sh(b0 + e / 2, e % 2 ? -23 : -28, e % 2 === 1)
    } else {
      for (let e = 0; e < 8; e++) {
        k(b0 + e / 2, -9 + e * 0.4)
        br(b0 + e / 2 + 0.25, -24 + e * 1.2)
      }
    }
  }
  put(riser(at(2.4)), 69.6, -15, 0, 0.3)
  // gap fills
  ;[[31.5, 76], [34.5, 74], [45.5, 72], [46, 76], [46.5, 79], [59, 69], [59.5, 72], [63.5, 76], [64, 79], [64.5, 84]].forEach(([b, m]) =>
    bell(b!, m!, -18),
  )
  ;[67, 71, 74, 79, 71, 74, 79, 83].forEach((m, i) => bell(70 + i * 0.25, m, -21 + i * 0.6))
  // title accents ride on the letter slaps
  bell(T.sticky / BEAT, 84, -22)
  bell(T.board / BEAT, 88, -22)

  // --- outro (beats 72-80) and the final chord ---
  for (let half = 0; half < 4; half++) {
    const b0 = 72 + half * 2
    const c = chordAt(b0)!
    bassNote(b0, c.root, -5, 0.95)
    bassNote(b0 + 1, c.fifth, -8, 0.6)
    strum(b0, c, -13)
    strum(b0 + 0.5, c, -19, true, 0.4)
    strum(b0 + 1, c, -16, false, 0.5)
    strum(b0 + 1.5, c, -19, true, 0.35)
    k(b0, -6)
    sn(b0 + 1, -16)
    for (let e = 0; e < 4; e++) sh(b0 + e / 2, e % 2 ? -23 : -28, e % 2 === 1)
  }
  put(brush(72, 1, 1.6), 72, -14, 0, 0.4)
  // the final chord rings out
  strum(80, CH.C!, -11, false, 2.6)
  bassNote(80, 36, -4, 2.8)
  k(80, -5)
  put(brush(80, 1, 2.2), 80, -15, 0, 0.5)
  put(pad([48, 55, 60, 64], at(8), { attack: 0.08, release: 2.2, cutoff: 1500 }), 80, -21, 0, 0.6)
  ;[84, 88, 91, 96].forEach((m, i) => bell(80 + i * 0.25, m, -16 - i))
  // a whistled tune once the narration is done
  const tune = [
    { b: 76.75, d: 0.25, m: 76 },
    { b: 77, d: 0.5, m: 77 },
    { b: 77.5, d: 0.5, m: 79 },
    { b: 78, d: 0.9, m: 81 },
    { b: 79, d: 0.45, m: 79 },
    { b: 79.5, d: 0.45, m: 83 },
    { b: 80, d: 3.2, m: 84 },
  ]
  const w = whistle(tune.map(x => ({ t: (x.b - 76.75) * BEAT, d: x.d * BEAT, m: x.m })), (84 - 76.75) * BEAT)
  put(w, 76.75, -19, 0.1, 0.45)

  return { dry, send }
}

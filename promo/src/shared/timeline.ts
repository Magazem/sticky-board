// One clock for picture and sound. Narration lines are placed on a 100 BPM grid,
// and every visual beat and sound effect is derived from the words as spoken, so
// the music, the voice and the animation land together.

import vo from '../../assets/vo.json'

export const FPS = 30
export const W = 1920
export const H = 1080
export const BPM = 100
export const BEAT = 60 / BPM
export const BAR = BEAT * 4
export const b = (beats: number) => beats * BEAT

type Word = { w: string; t0: number; t1: number }
type Line = { id: string; text: string; file: string; duration: number; words: Word[] }

const lines = vo.lines as Line[]
const norm = (s: string) => s.toLowerCase().replace(/[^a-z']/g, '')

// [line, word to anchor on (or null for the line start), beat it lands on]
const PLACEMENT: [string, string | null, number][] = [
  ['loose', null, 2],
  ['bug', null, 6],
  ['key', null, 9],
  ['todo', null, 12],
  ['scatter', 'scatter', 20],
  ['pin', 'pin', 23],
  ['meet', 'sticky', 25],
  ['phase', null, 32],
  ['lists', null, 35],
  ['current', null, 47],
  ['nudge', null, 54.5],
  ['glance', null, 60],
  ['project', null, 65],
  ['outro', null, 72],
]

function lineOf(id: string) {
  const line = lines.find(l => l.id === id)
  if (!line) throw new Error(`no narration line ${id}`)
  return line
}

function wordOffset(line: Line, word: string, nth = 0) {
  const hits = line.words.filter(w => norm(w.w) === norm(word))
  const hit = hits[nth]
  if (!hit) throw new Error(`"${word}" #${nth} not in line ${line.id}`)
  return hit.t0
}

export const voice = PLACEMENT.map(([id, anchor, beat]) => {
  const line = lineOf(id)
  const start = b(beat) - (anchor ? wordOffset(line, anchor) : 0)
  return { id, start, end: start + line.duration, file: line.file, text: line.text, words: line.words }
})

export const start = (id: string) => voice.find(v => v.id === id)!.start
export const end = (id: string) => voice.find(v => v.id === id)!.end
export const word = (id: string, w: string, nth = 0) => start(id) + wordOffset(lineOf(id), w, nth)

// Named beats of the film, in seconds. Scenes and sound effects both read these.
export const T = {
  // scene 1: a project folder spills loose ends
  folderLand: 0.32,
  threads: 0.62,
  tagPops: [1.05, 1.32, 1.6, word('loose', 'loose') + 0.02, word('loose', 'ends') + 0.04],
  bug: start('bug'),
  midnight: word('bug', 'midnight'),
  key: start('key'),
  rotate: word('key', 'rotate'),
  todo: start('todo'),
  eventually: word('todo', 'eventually'),
  session: start('scatter'),
  gust: word('scatter', 'scatter'),
  rip: b(21.2),
  // scene 2: pinned to the cork board, then the title
  tagsBack: b(22.2),
  pins: [b(23), b(23.5), b(24)],
  sticky: word('meet', 'sticky'),
  board: word('meet', 'board'),
  subtitle: word('meet', 'tiny'),
  toTerminal: b(29),
  // scene 3: the pane, annotated
  phase: word('phase', 'phase'),
  three: word('lists', 'three'),
  listAI: word('lists', 'what'),
  listYou: word('lists', 'what', 1),
  listBugs: word('lists', 'bugs'),
  // scene 4: Claude at work
  current: start('current'),
  files: word('current', 'files'),
  ticks: word('current', 'ticks'),
  nudge: word('nudge', 'nudge'),
  lands: word('nudge', 'lands'),
  // scene 5: you click
  glance: word('glance', 'glance'),
  click: word('glance', 'click'),
  tick: word('glance', 'tick'),
  // scene 6: one board per project, one file
  projects: [word('project', 'one'), word('project', 'board'), word('project', 'project')],
  file: word('project', 'all'),
  // finale
  outro: start('outro'),
  outroBoard: word('outro', 'board'),
  keep: word('outro', 'keep'),
  endCard: b(77.5),
  final: b(80),
  fadeOut: 50.1,
  end: 51,
}

// Hits that both picture and sound need.
export const HITS = {
  // ransom letters slap down one after another (STICKY, then BOARD)
  letters: [...[0, 1, 2, 3, 4, 5].map(i => T.sticky + i * 0.055), ...[0, 1, 2, 3, 4].map(i => T.board + i * 0.055)],
  // in the finale each letter hops and lands again
  hop: (i: number) => T.outro - 0.12 + i * 0.035,
  // the annotation labels drop onto the cork
  labels: [T.phase - 0.15, T.three - 0.15, T.listAI - 0.12, T.listYou - 0.12, T.listBugs - 0.12],
  labelFall: 0.22,
  // the gust tears each tag free, left to right across the desk
  detach: (deskX: number) => T.gust - 0.05 + ((deskX - 200) / 1700) * 0.35,
}

export const DURATION = T.end
export const FRAMES = Math.round(DURATION * FPS)

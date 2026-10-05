// Entry point: loads fonts, bakes textures, then exposes `window.film` so the
// renderer can ask for any frame. Opened in a browser it plays live with sound.

import { DURATION, FPS, H, W } from '../shared/timeline'
import { initPaper } from './paper'
import { drawFrame, initScenes } from './scenes'

const FONT_FILES: [string, string, string][] = [
  ['Caveat', 'caveat/files/caveat-latin-700-normal.woff2', '700'],
  ['Caveat', 'caveat/files/caveat-latin-400-normal.woff2', '400'],
  ['Gochi Hand', 'gochi-hand/files/gochi-hand-latin-400-normal.woff2', '400'],
  ['Kalam', 'kalam/files/kalam-latin-700-normal.woff2', '700'],
  ['Permanent Marker', 'permanent-marker/files/permanent-marker-latin-400-normal.woff2', '400'],
  ['JetBrains Mono', 'jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2', '400'],
  ['JetBrains Mono', 'jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2', '700'],
  ['Special Elite', 'special-elite/files/special-elite-latin-400-normal.woff2', '400'],
  ['Anton', 'anton/files/anton-latin-400-normal.woff2', '400'],
  ['Abril Fatface', 'abril-fatface/files/abril-fatface-latin-400-normal.woff2', '400'],
  ['Bungee', 'bungee/files/bungee-latin-400-normal.woff2', '400'],
  ['Rubik Mono One', 'rubik-mono-one/files/rubik-mono-one-latin-400-normal.woff2', '400'],
  ['Bebas Neue', 'bebas-neue/files/bebas-neue-latin-400-normal.woff2', '400'],
  ['Playfair Display', 'playfair-display/files/playfair-display-latin-900-normal.woff2', '900'],
  ['Alfa Slab One', 'alfa-slab-one/files/alfa-slab-one-latin-400-normal.woff2', '400'],
  ['Archivo Black', 'archivo-black/files/archivo-black-latin-400-normal.woff2', '400'],
  ['Shrikhand', 'shrikhand/files/shrikhand-latin-400-normal.woff2', '400'],
]

async function loadFonts() {
  await Promise.all(
    FONT_FILES.map(async ([family, file, weight]) => {
      const face = new FontFace(family, `url(node_modules/@fontsource/${file})`, { weight })
      document.fonts.add(await face.load())
    }),
  )
}

const el = document.getElementById('film') as HTMLCanvasElement
el.width = W
el.height = H
const g = el.getContext('2d')!

const ready = (async () => {
  await loadFonts()
  initPaper()
  initScenes()
})()

declare global {
  interface Window {
    film: {
      ready: Promise<void>
      fps: number
      duration: number
      draw: (t: number) => void
      frame: (t: number, type?: string, quality?: number) => string
    }
  }
}

window.film = {
  ready,
  fps: FPS,
  duration: DURATION,
  draw: t => drawFrame(g, t),
  frame: (t, type = 'image/png', quality) => {
    drawFrame(g, t)
    return el.toDataURL(type, quality)
  },
}

// Live playback when opened as a page (the renderer passes ?render).
if (!location.search.includes('render')) {
  const status = document.getElementById('status')!
  const play = document.getElementById('play') as HTMLButtonElement
  const audio = document.getElementById('audio') as HTMLAudioElement
  void ready.then(() => {
    drawFrame(g, 0)
    status.textContent = ''
    play.hidden = false
    play.onclick = () => {
      play.hidden = true
      audio.currentTime = 0
      void audio.play()
      const tickFrame = () => {
        drawFrame(g, Math.min(audio.currentTime, DURATION - 1e-3))
        if (!audio.ended && audio.currentTime < DURATION) requestAnimationFrame(tickFrame)
        else play.hidden = false
      }
      requestAnimationFrame(tickFrame)
    }
  })
}

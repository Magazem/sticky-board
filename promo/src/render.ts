// Renders the film frame by frame in headless Chromium and encodes it with ffmpeg.
//
//   tsx src/render.ts                    every frame, then build/sticky-board.mp4
//   tsx src/render.ts --stills 3.5,12    single frames to build/stills/ (for checking)
//   tsx src/render.ts --from 10 --to 14  a slice of frames, no encode
//   tsx src/render.ts --serve            serve the page to watch it live with sound
//
// Every frame is a pure function of time, so workers render interleaved slices.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { chromium } from 'playwright'

const root = path.resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? undefined : args[i + 1]
}
const flag = (name: string) => args.includes(`--${name}`)

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
  '.png': 'image/png',
}

function serve(port = 0) {
  const server = http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url!, 'http://x').pathname))
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  return new Promise<{ url: string; close: () => void }>(ok =>
    server.listen(port, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      ok({ url: `http://127.0.0.1:${port}/index.html?render`, close: () => server.close() })
    }),
  )
}

async function run(cmd: string, argv: string[]) {
  await new Promise<void>((ok, fail) => {
    const p = spawn(cmd, argv, { stdio: ['ignore', 'inherit', 'inherit'] })
    p.on('exit', code => (code === 0 ? ok() : fail(new Error(`${cmd} exited ${code}`))))
  })
}

async function main() {
  if (flag('serve')) {
    const { url } = await serve(Number(opt('port') ?? 8080))
    console.log(`watch it at ${url.replace('?render', '')}`)
    return
  }
  const { url, close } = await serve()
  const browser = await chromium.launch({ args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling'] })
  const workers = Number(opt('workers') ?? 4)

  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
    page.on('console', m => console.log('[page]', m.text()))
    page.on('pageerror', e => console.error('[page error]', e.message))
    await page.goto(url)
    await page.evaluate(() => window.film.ready)
    return page
  }

  const stills = opt('stills')
  if (stills) {
    const dir = path.join(root, 'build', 'stills')
    fs.mkdirSync(dir, { recursive: true })
    const times = stills.split(',').map(Number)
    const pages = await Promise.all(Array.from({ length: Math.min(workers, times.length) }, open))
    await Promise.all(
      pages.map(async (page, w) => {
        for (let i = w; i < times.length; i += pages.length) {
          const t = times[i]!
          const data = await page.evaluate(t => window.film.frame(t), t)
          const name = path.join(dir, `t${t.toFixed(2).padStart(6, '0')}.png`)
          fs.writeFileSync(name, Buffer.from(data.split(',')[1]!, 'base64'))
          console.log(name)
        }
      }),
    )
    await browser.close()
    close()
    return
  }

  const first = await open()
  const fps = await first.evaluate(() => window.film.fps)
  const duration = await first.evaluate(() => window.film.duration)
  const from = Math.round(Number(opt('from') ?? 0) * fps)
  const to = Math.round(Number(opt('to') ?? duration) * fps)
  const dir = path.join(root, 'build', 'frames')
  fs.mkdirSync(dir, { recursive: true })
  const pages = [first, ...(await Promise.all(Array.from({ length: workers - 1 }, open)))]
  const started = Date.now()
  let done = 0
  await Promise.all(
    pages.map(async (page, w) => {
      for (let f = from + w; f < to; f += pages.length) {
        const out = path.join(dir, `${String(f).padStart(5, '0')}.png`)
        if (flag('resume') && fs.existsSync(out)) continue
        const data = await page.evaluate(t => window.film.frame(t), f / fps)
        fs.writeFileSync(out, Buffer.from(data.split(',')[1]!, 'base64'))
        if (++done % 60 === 0) {
          const rate = done / ((Date.now() - started) / 1000)
          console.log(`${done}/${to - from} frames, ${rate.toFixed(1)} fps`)
        }
      }
    }),
  )
  await browser.close()
  close()
  console.log(`rendered ${to - from} frames in ${((Date.now() - started) / 1000).toFixed(0)}s`)

  if (from === 0 && to >= Math.round(duration * fps) && !flag('no-encode')) {
    const audio = path.join(root, 'build', 'audio.wav')
    const out = path.join(root, 'build', 'sticky-board.mp4')
    await run('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-framerate', String(fps), '-i', path.join(dir, '%05d.png'),
      ...(fs.existsSync(audio) ? ['-i', audio] : []),
      '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-tune', 'film',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-x264-params', 'keyint=60',
      ...(fs.existsSync(audio) ? ['-c:a', 'aac', '-b:a', '256k', '-shortest'] : []),
      '-movflags', '+faststart', out,
    ])
    console.log(out)
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})

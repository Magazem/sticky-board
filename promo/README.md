# Sticky Board — the film

A 51-second explainer for Sticky Board, made entirely in code. Nothing is drawn by hand: paper, cork, tape, pushpins, ink and handwriting are generated procedurally on a canvas. The music and sound effects are synthesized sample by sample, and the narration comes from an open-source text-to-speech model.

## How it's made

| Part | What it is |
| --- | --- |
| `script.json` | The narration, one line per beat of the story |
| `tts/voiceover.py` | Speaks the lines with [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (voice `af_heart`), then aligns every word with Whisper so the picture can hit exact words → `assets/vo/`, `assets/vo.json` |
| `src/shared/timeline.ts` | One clock for picture and sound: lines sit on a 100 BPM grid, and every visual beat and sound cue is derived from the spoken words |
| `src/visual/` | The animation: seeded noise and easing (`core`), paper and cork textures (`textures`), torn cut-outs with shadows, tape and pins (`paper`), boiling ink, handwriting and doodles (`ink`), and the scenes (`desk`, `terminal`, `world`, `scenes`) |
| `src/audio/` | Karplus-Strong ukulele and upright bass, glockenspiel, a whistled tune and a small drum kit (`instruments`), the score (`music`), synthesized foley (`sfx`), and the mixer with ducking, a lookahead limiter and loudness normalization (`mix`) |
| `src/render.ts` | Renders every frame in headless Chromium (four workers in parallel), then encodes with ffmpeg |

Every frame is a pure function of time, so any frame can be rendered alone and in any order. Fast camera moves get motion blur from averaged sub-frames.

## Build it

Needs Node 20+, ffmpeg and Chromium for Playwright.

```sh
npm install
npm run audio     # music + foley + narration → build/audio.wav
npm run render    # frames → build/sticky-board.mp4
npm run preview   # or watch it live at http://127.0.0.1:8080/index.html
```

The narration is already in `assets/`. To regenerate it, for example after editing `script.json`:

```sh
pip install kokoro-onnx soundfile faster-whisper
# kokoro-v1.0.onnx and voices-v1.0.bin from github.com/thewh1teagle/kokoro-onnx/releases
python3 tts/voiceover.py path/to/models
```

Single frames are handy while working on a scene: `npx tsx src/render.ts --stills 12.3,20.5` writes them to `build/stills/`.

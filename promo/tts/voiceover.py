"""Generate the narration with Kokoro (open-source TTS, runs locally on CPU),
then align every word with faster-whisper so the animation can hit exact words.

usage: python3 tts/voiceover.py <models dir>
writes assets/vo/<id>.wav (24 kHz mono) and assets/vo.json
"""
import json, os, sys

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro
from faster_whisper import WhisperModel

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(here)
models = sys.argv[1]
voice_override = sys.argv[2] if len(sys.argv) > 2 else None
script = json.load(open(os.path.join(root, "script.json")))
out_dir = os.path.join(root, "assets", "vo")
os.makedirs(out_dir, exist_ok=True)

from kokoro_onnx.tokenizer import Tokenizer

tokenizer = Tokenizer()
kokoro = Kokoro(os.path.join(models, "kokoro-v1.0.onnx"), os.path.join(models, "voices-v1.0.bin"))
whisper = WhisperModel("small.en", device="cpu", compute_type="int8")
voice = voice_override or script["voice"]


def trim(samples, sr, pad=0.04, floor_db=-45):
    """Cut leading/trailing silence, keeping a short natural pad."""
    env = np.abs(samples)
    win = int(sr * 0.01)
    env = np.convolve(env, np.ones(win) / win, mode="same")
    loud = np.where(env > 10 ** (floor_db / 20))[0]
    if len(loud) == 0:
        return samples
    a = max(0, loud[0] - int(pad * sr))
    b = min(len(samples), loud[-1] + int(pad * 2 * sr))
    return samples[a:b]


lines = []
for line in script["lines"]:
    # Phonemize ourselves so known mispronunciations can be patched (e.g. "to-do").
    phonemes = tokenizer.phonemize(line["text"], "en-us")
    for wrong, right in script.get("pronounce", {}).items():
        phonemes = phonemes.replace(wrong, right)
    samples, sr = kokoro.create(phonemes, voice=voice, speed=script["speed"], is_phonemes=True)
    samples = trim(np.asarray(samples, dtype=np.float32), sr)
    path = os.path.join(out_dir, f"{line['id']}.wav")
    sf.write(path, samples, sr)
    segs, _ = whisper.transcribe(path, word_timestamps=True, language="en", beam_size=5)
    words = [
        {"w": w.word.strip(), "t0": round(w.start, 3), "t1": round(w.end, 3)}
        for s in segs
        for w in s.words
    ]
    heard = " ".join(w["w"] for w in words)
    lines.append({**line, "file": f"vo/{line['id']}.wav", "duration": round(len(samples) / sr, 3), "words": words})
    print(f"{line['id']:9s} {len(samples) / sr:5.2f}s  heard: {heard}")

json.dump({"voice": voice, "sampleRate": sr, "lines": lines}, open(os.path.join(root, "assets", "vo.json"), "w"), indent=1)
print("total speech", round(sum(l["duration"] for l in lines), 2), "s")

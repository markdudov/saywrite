import { describe, expect, test } from 'vitest'
import { decodeWav, encodeWav } from '@shared/audio/wav'
import {
  durationMs,
  floatToInt16,
  hasSpeech,
  splitAtSilence,
  trimSilence
} from '@shared/audio/analysis'

const RATE = 16000

/** Sine of `ms` milliseconds whose RMS level is `dBFS` (relative to 32768). */
function tone(ms: number, dBFS: number): Int16Array {
  const n = Math.round((ms * RATE) / 1000)
  const peak = 32768 * Math.pow(10, dBFS / 20) * Math.SQRT2
  const out = new Int16Array(n)
  for (let i = 0; i < n; i++) out[i] = Math.round(peak * Math.sin((2 * Math.PI * 440 * i) / RATE))
  return out
}

function concat(...parts: Int16Array[]): Int16Array {
  const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

const GAP_SEC = 0.5
const FIRST_GAP_SEC = 560
const GAP_EVERY_SEC = 540

/** Speech-level tone with 500 ms silent gaps at 560 s, 1100 s, 1640 s, ... (each in the last 20 % of a 600 s window). */
function speechWithGaps(
  totalSec: number,
  rate: number
): { pcm: Int16Array; gaps: [number, number][] } {
  const pcm = new Int16Array(totalSec * rate)
  const peak = 32768 * Math.pow(10, -20 / 20) * Math.SQRT2
  const gaps: [number, number][] = []
  for (let g = FIRST_GAP_SEC; g < totalSec; g += GAP_EVERY_SEC) {
    gaps.push([g * rate, (g + GAP_SEC) * rate])
  }
  let gi = 0
  for (let i = 0; i < pcm.length; i++) {
    while (gi < gaps.length && i >= gaps[gi][1]) gi++
    if (gi < gaps.length && i >= gaps[gi][0]) continue
    pcm[i] = Math.round(peak * Math.sin((2 * Math.PI * 440 * i) / rate))
  }
  return { pcm, gaps }
}

describe('wav', () => {
  test('wav round-trip', () => {
    const pcm = Int16Array.from([0, 1000, -1000, 32767, -32768])
    const bytes = encodeWav(pcm, 16000)
    expect(bytes.length).toBe(44 + 10)
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF')
    expect(decodeWav(bytes)).toEqual({ pcm, sampleRate: 16000 })
  })

  test('decodeWav rejects garbage', () => {
    expect(() => decodeWav(new Uint8Array(10))).toThrow()
    expect(() => decodeWav(new Uint8Array(60))).toThrow(/RIFF/)
  })

  test('decodeWav rejects non-PCM16 mono', () => {
    const base = encodeWav(Int16Array.from([1, 2, 3]), 16000)
    const stereo = base.slice()
    new DataView(stereo.buffer).setUint16(22, 2, true)
    expect(() => decodeWav(stereo)).toThrow(/mono/)
    const float = base.slice()
    new DataView(float.buffer).setUint16(20, 3, true)
    expect(() => decodeWav(float)).toThrow(/PCM/)
    const bits8 = base.slice()
    new DataView(bits8.buffer).setUint16(34, 8, true)
    expect(() => decodeWav(bits8)).toThrow(/16-bit/)
  })
})

describe('analysis', () => {
  test('floatToInt16 clamps', () =>
    expect(Array.from(floatToInt16(Float32Array.from([-1.5, -1, 0, 0.5, 1, 2])))).toEqual([
      -32768, -32768, 0, 16384, 32767, 32767
    ]))

  test('durationMs', () => expect(durationMs(8000, 16000)).toBe(500))

  test('hasSpeech', () => {
    expect(hasSpeech(new Int16Array(16000), 16000)).toBe(false)
    expect(hasSpeech(tone(100, -20), 16000)).toBe(false)
    expect(hasSpeech(tone(400, -20), 16000)).toBe(true)
    expect(hasSpeech(tone(400, -50), 16000)).toBe(false)
  })

  test('hasSpeech counts non-contiguous speech frames', () => {
    const gap = new Int16Array(4800)
    expect(hasSpeech(concat(tone(90, -20), gap, tone(90, -20)), 16000)).toBe(true)
  })

  test('trimSilence keeps 200 ms padding', () => {
    const sil = new Int16Array(16000)
    const out = trimSilence(concat(sil, tone(500, -20), sil), 16000)
    // 500 ms tone + 2 x 200 ms pad = 900 ms, plus up to one 30 ms frame of boundary slack
    const ms = durationMs(out.length, 16000)
    expect(ms).toBeGreaterThanOrEqual(900)
    expect(ms).toBeLessThanOrEqual(930)
  })

  test('trimSilence clamps to buffer and returns empty without speech', () => {
    const t = tone(300, -20)
    expect(trimSilence(t, 16000).length).toBe(t.length)
    expect(trimSilence(new Int16Array(16000), 16000).length).toBe(0)
  })

  test('splitAtSilence returns single chunk when it fits', () => {
    const pcm = tone(1000, -20)
    const chunks = splitAtSilence(pcm, 16000, 10)
    expect(chunks.length).toBe(1)
    expect(chunks[0]).toEqual(pcm)
  })

  test('splitAtSilence respects limit and cuts at silence', () => {
    const { pcm, gaps } = speechWithGaps(30 * 60, 16000)
    const chunks = splitAtSilence(pcm, 16000, 600)
    chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(600 * 16000))
    expect(chunks.reduce((n, c) => n + c.length, 0)).toBe(pcm.length)
    // chunks are views of the original, in order -> exact reconstruction
    let off = 0
    const cuts: number[] = []
    for (const c of chunks) {
      expect(c.buffer).toBe(pcm.buffer)
      expect(c.byteOffset / 2).toBe(off)
      off += c.length
      if (off < pcm.length) cuts.push(off)
    }
    expect(cuts.length).toBe(gaps.length)
    cuts.forEach((cut, i) => {
      expect(cut).toBeGreaterThanOrEqual(gaps[i][0])
      expect(cut).toBeLessThanOrEqual(gaps[i][1])
    })
  })
})

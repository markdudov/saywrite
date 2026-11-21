const FRAME_MS = 30
const SPEECH_THRESHOLD_DBFS = -40
const MIN_SPEECH_MS = 150
const FULL_SCALE = 32768

function frameSize(sampleRate: number): number {
  return Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000))
}

/** Mean-square energy of pcm[start, end). */
function meanSquare(pcm: Int16Array, start: number, end: number): number {
  let sum = 0
  for (let i = start; i < end; i++) sum += pcm[i] * pcm[i]
  return sum / (end - start)
}

const THRESHOLD_MEAN_SQUARE = Math.pow(FULL_SCALE * Math.pow(10, SPEECH_THRESHOLD_DBFS / 20), 2)

/** Converts float samples (-1..1) to PCM16 with clamping. */
export function floatToInt16(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length)
  for (let i = 0; i < f.length; i++) {
    const s = Math.max(-1, Math.min(1, f[i]))
    out[i] = Math.round(s < 0 ? s * 32768 : s * 32767)
  }
  return out
}

export function durationMs(samples: number, sampleRate: number): number {
  return (samples / sampleRate) * 1000
}

/** True when frames above -40 dBFS RMS total at least 150 ms (need not be contiguous). */
export function hasSpeech(pcm: Int16Array, sampleRate: number): boolean {
  const size = frameSize(sampleRate)
  const needed = (MIN_SPEECH_MS / 1000) * sampleRate
  let speechSamples = 0
  for (let start = 0; start < pcm.length; start += size) {
    const end = Math.min(start + size, pcm.length)
    if (meanSquare(pcm, start, end) > THRESHOLD_MEAN_SQUARE) {
      speechSamples += end - start
      if (speechSamples >= needed) return true
    }
  }
  return false
}

/** Keeps first-speech-frame start minus pad through last-speech-frame end plus pad; empty if no speech. */
export function trimSilence(pcm: Int16Array, sampleRate: number, padMs = 200): Int16Array {
  const size = frameSize(sampleRate)
  let first = -1
  let last = -1
  for (let start = 0; start < pcm.length; start += size) {
    const end = Math.min(start + size, pcm.length)
    if (meanSquare(pcm, start, end) > THRESHOLD_MEAN_SQUARE) {
      if (first < 0) first = start
      last = end
    }
  }
  if (first < 0) return new Int16Array(0)
  const pad = Math.round((padMs / 1000) * sampleRate)
  return pcm.slice(Math.max(0, first - pad), Math.min(pcm.length, last + pad))
}

/**
 * Splits into chunks of at most maxChunkSec, cutting at the start of the quietest 30 ms frame
 * (ties: the later one) in the last 20 % of each window. Chunks are views of `pcm`; they
 * concatenate back to exactly the input.
 */
export function splitAtSilence(
  pcm: Int16Array,
  sampleRate: number,
  maxChunkSec: number
): Int16Array[] {
  const max = Math.floor(maxChunkSec * sampleRate)
  if (max <= 0) throw new Error('maxChunkSec must be positive')
  if (pcm.length <= max) return [pcm]
  const size = frameSize(sampleRate)
  const chunks: Int16Array[] = []
  let start = 0
  while (pcm.length - start > max) {
    const windowEnd = start + max
    const searchStart = Math.max(start + 1, windowEnd - Math.floor(max * 0.2))
    let cut = windowEnd
    let best = Infinity
    for (let f = searchStart; f < windowEnd; f += size) {
      const energy = meanSquare(pcm, f, Math.min(f + size, windowEnd))
      if (energy <= best) {
        best = energy
        cut = f
      }
    }
    chunks.push(pcm.subarray(start, cut))
    start = cut
  }
  chunks.push(pcm.subarray(start))
  return chunks
}

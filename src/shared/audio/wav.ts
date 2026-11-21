const HEADER_BYTES = 44

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
}

function readAscii(view: DataView, offset: number, length: number): string {
  let s = ''
  for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i))
  return s
}

/** Encodes mono 16-bit PCM as a canonical 44-byte-header WAV file. */
export function encodeWav(pcm: Int16Array, sampleRate: number): Uint8Array {
  const dataBytes = pcm.length * 2
  const out = new Uint8Array(HEADER_BYTES + dataBytes)
  const view = new DataView(out.buffer)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)
  for (let i = 0; i < pcm.length; i++) view.setInt16(HEADER_BYTES + i * 2, pcm[i], true)
  return out
}

/** Decodes a RIFF/WAVE PCM 16-bit mono file; throws on anything else. */
export function decodeWav(bytes: Uint8Array): { pcm: Int16Array; sampleRate: number } {
  if (bytes.length < 12) throw new Error('Invalid WAV: file too short')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
    throw new Error('Invalid WAV: missing RIFF/WAVE header')
  }
  let fmt: { sampleRate: number } | null = null
  let pos = 12
  while (pos + 8 <= bytes.length) {
    const id = readAscii(view, pos, 4)
    const size = view.getUint32(pos + 4, true)
    const body = pos + 8
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > bytes.length) throw new Error('Invalid WAV: truncated fmt chunk')
      if (view.getUint16(body, true) !== 1)
        throw new Error('Unsupported WAV: only PCM (format 1) is supported')
      if (view.getUint16(body + 2, true) !== 1)
        throw new Error('Unsupported WAV: only mono is supported')
      if (view.getUint16(body + 14, true) !== 16)
        throw new Error('Unsupported WAV: only 16-bit is supported')
      fmt = { sampleRate: view.getUint32(body + 4, true) }
    } else if (id === 'data') {
      if (!fmt) throw new Error('Invalid WAV: data chunk before fmt chunk')
      const available = Math.min(size, bytes.length - body)
      const count = Math.floor(available / 2)
      const pcm = new Int16Array(count)
      for (let i = 0; i < count; i++) pcm[i] = view.getInt16(body + i * 2, true)
      return { pcm, sampleRate: fmt.sampleRate }
    }
    pos = body + size + (size & 1)
  }
  throw new Error('Invalid WAV: no data chunk')
}

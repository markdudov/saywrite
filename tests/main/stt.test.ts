import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createDeepgramAdapter } from '../../src/main/providers/stt/deepgram'
import { createElevenLabsAdapter } from '../../src/main/providers/stt/elevenlabs'
import { createSttAdapter, sttFor } from '../../src/main/providers/registry'
import type { SttRequest } from '../../src/main/providers/stt/openaiCompatible'
import { defaultSettings } from '../../src/shared/schemas/settings'

type Seen = {
  method: string
  path: string
  query: URLSearchParams
  headers: Record<string, string | string[] | undefined>
  fields: Record<string, string>
  files: Record<string, { filename: string; mimeType: string }>
  raw: Buffer
}

let server: Server
let base = ''
let last: Seen
let status = 200
let reply: unknown = {}

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', async () => {
      const raw = Buffer.concat(chunks)
      const u = new URL(req.url ?? '/', 'http://x')
      const seen: Seen = {
        method: req.method ?? '',
        path: u.pathname,
        query: u.searchParams,
        headers: req.headers,
        fields: {},
        files: {},
        raw
      }
      const ct = String(req.headers['content-type'] ?? '')
      if (ct.startsWith('multipart/form-data')) {
        const fd = await new Response(raw, { headers: { 'content-type': ct } }).formData()
        for (const [k, v] of fd.entries()) {
          if (typeof v === 'string') seen.fields[k] = v
          else seen.files[k] = { filename: v.name, mimeType: v.type }
        }
      }
      last = seen
      res.statusCode = status
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(reply))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => {
  server.close()
})
beforeEach(() => {
  status = 200
  reply = { text: 'server text' }
})

const wav = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4])
const req = (over: Record<string, unknown> = {}): SttRequest => ({
  audio: wav,
  durationMs: 1000,
  model: 'gpt-4o-mini-transcribe',
  language: 'bg',
  vocabulary: ['Claude', 'Saywrite'],
  apiKey: 'k',
  ...over
})

describe('openai-compatible', () => {
  test('openai request shape', async () => {
    const a = createSttAdapter('openai', { baseUrl: `${base}/v1` })
    const r = await a.transcribe(req(), { timeoutMs: 2000 })
    expect(last.method).toBe('POST')
    expect(last.path).toBe('/v1/audio/transcriptions')
    expect(last.headers.authorization).toBe('Bearer k')
    expect(last.fields).toMatchObject({
      model: 'gpt-4o-mini-transcribe',
      language: 'bg',
      prompt: 'Claude, Saywrite',
      response_format: 'json'
    })
    expect(last.files.file).toMatchObject({ filename: 'audio.wav', mimeType: 'audio/wav' })
    expect(r.text).toBe('server text')
    expect(a.maxChunkSec).toBe(600)
  })

  test('auto language and empty vocabulary are omitted', async () => {
    const a = createSttAdapter('groq', { baseUrl: `${base}/v1` })
    await a.transcribe(req({ language: 'auto', vocabulary: [] }), { timeoutMs: 2000 })
    expect(last.fields).not.toHaveProperty('language')
    expect(last.fields).not.toHaveProperty('prompt')
  })

  test('custom-stt without key sends no Authorization; trailing slash normalized', async () => {
    const a = createSttAdapter('custom-stt', { baseUrl: `${base}/v1/` })
    await a.transcribe(req({ apiKey: '' }), { timeoutMs: 2000 })
    expect(last.path).toBe('/v1/audio/transcriptions')
    expect(last.headers.authorization).toBeUndefined()
  })

  test('empty custom base url throws bad_request before any call', async () => {
    const a = createSttAdapter('custom-stt', { baseUrl: '' })
    await expect(a.transcribe(req(), { timeoutMs: 2000 })).rejects.toMatchObject({
      kind: 'bad_request',
      provider: 'custom-stt'
    })
  })

  test('empty text returns empty string; missing field is server error', async () => {
    const a = createSttAdapter('openai', { baseUrl: `${base}/v1` })
    reply = { text: '' }
    expect((await a.transcribe(req(), { timeoutMs: 2000 })).text).toBe('')
    reply = {}
    await expect(a.transcribe(req(), { timeoutMs: 2000 })).rejects.toMatchObject({
      kind: 'server'
    })
  })

  test('401 maps to auth', async () => {
    status = 401
    reply = { error: { message: 'bad key' } }
    const a = createSttAdapter('openai', { baseUrl: `${base}/v1` })
    await expect(a.transcribe(req(), { timeoutMs: 2000 })).rejects.toMatchObject({
      kind: 'auth',
      provider: 'openai'
    })
  })
})

describe('deepgram', () => {
  const dgReply = { results: { channels: [{ alternatives: [{ transcript: 'dg text' }] }] } }

  test('query, auth and parsing', async () => {
    reply = dgReply
    const a = createDeepgramAdapter({ baseUrl: `${base}/v1` })
    const r = await a.transcribe(req({ model: 'nova-3' }), { timeoutMs: 2000 })
    expect(last.path).toBe('/v1/listen')
    expect(last.query.get('model')).toBe('nova-3')
    expect(last.query.get('smart_format')).toBe('true')
    expect(last.query.get('punctuate')).toBe('true')
    expect(last.query.get('language')).toBe('bg')
    expect(last.query.getAll('keyterm')).toEqual(['Claude', 'Saywrite'])
    expect(last.headers.authorization).toBe('Token k')
    expect(last.headers['content-type']).toBe('audio/wav')
    expect(last.raw.equals(Buffer.from(wav))).toBe(true)
    expect(r.text).toBe('dg text')
  })

  test('auto language uses detect_language; keyterm only for nova-3', async () => {
    reply = dgReply
    const a = createDeepgramAdapter({ baseUrl: `${base}/v1` })
    await a.transcribe(req({ model: 'nova-2', language: 'auto' }), { timeoutMs: 2000 })
    expect(last.query.get('detect_language')).toBe('true')
    expect(last.query.has('language')).toBe(false)
    expect(last.query.has('keyterm')).toBe(false)
  })

  test('missing transcript is a server error', async () => {
    reply = {}
    const a = createDeepgramAdapter({ baseUrl: `${base}/v1` })
    await expect(a.transcribe(req(), { timeoutMs: 2000 })).rejects.toMatchObject({
      kind: 'server'
    })
  })
})

describe('elevenlabs', () => {
  test('request shape', async () => {
    const a = createElevenLabsAdapter({ baseUrl: `${base}/v1` })
    const r = await a.transcribe(req({ model: 'scribe_v2' }), { timeoutMs: 2000 })
    expect(last.path).toBe('/v1/speech-to-text')
    expect(last.headers['xi-api-key']).toBe('k')
    expect(last.fields).toMatchObject({
      model_id: 'scribe_v2',
      language_code: 'bg',
      tag_audio_events: 'false'
    })
    expect(last.fields).not.toHaveProperty('prompt')
    expect(last.files.file).toMatchObject({ filename: 'audio.wav', mimeType: 'audio/wav' })
    expect(r.text).toBe('server text')
  })

  test('auto omits language_code', async () => {
    const a = createElevenLabsAdapter({ baseUrl: `${base}/v1` })
    await a.transcribe(req({ language: 'auto' }), { timeoutMs: 2000 })
    expect(last.fields).not.toHaveProperty('language_code')
  })
})

describe('registry', () => {
  test('sttFor wiring', () => {
    const s = defaultSettings('darwin')
    expect(sttFor('openai', s).id).toBe('openai')
    const c = { ...s, providers: { ...s.providers, customStt: { baseUrl: 'http://h/v1/' } } }
    expect(sttFor('custom-stt', c).id).toBe('custom-stt')
    expect(sttFor('deepgram', s).maxChunkSec).toBe(3600)
    expect(() => sttFor('local', s)).toThrow('Local Whisper arrives in a later update')
  })
})

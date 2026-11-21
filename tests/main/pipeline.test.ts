import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { HistoryRepository } from '../../src/main/history/repository'
import { RecordingFiles } from '../../src/main/history/files'
import {
  runAiStep,
  runDictation,
  type DictationJob,
  type PipelineDeps
} from '../../src/main/pipeline/runDictation'
import { ProviderError } from '../../src/main/providers/errors'
import type { SttAdapter, SttRequest } from '../../src/main/providers/stt/openaiCompatible'
import type { LlmAdapter, LlmRequest } from '../../src/main/providers/llm/types'
import { ModeSchema, type Mode } from '@shared/schemas/mode'
import { defaultSettings, type Settings } from '@shared/schemas/settings'
import type { RecordingStatus, Variant } from '@shared/schemas/recording'
import type { LlmProviderId, SecretId, SttProviderId } from '@shared/providers'
import { encodeWav } from '@shared/audio/wav'
import { loadPricing } from '@shared/cost/pricing'

type FakeStt = SttAdapter & {
  calls: SttRequest[]
  timeouts: number[]
  impl: (req: SttRequest, signal?: AbortSignal) => Promise<string>
  returns(t: string): void
}
type FakeLlm = LlmAdapter & {
  calls: LlmRequest[]
  impl: (req: LlmRequest) => Promise<string>
  returns(t: string): void
}

const fakeStt = (id: SttProviderId, maxChunkSec = 600): FakeStt => {
  const a: FakeStt = {
    id,
    maxChunkSec,
    calls: [],
    timeouts: [],
    impl: async () => '',
    returns(t) {
      a.impl = async () => t
    },
    async transcribe(req, opts) {
      a.calls.push(req)
      a.timeouts.push(opts.timeoutMs)
      return { text: await a.impl(req, opts.signal) }
    }
  }
  return a
}
const fakeLlm = (id: LlmProviderId): FakeLlm => {
  const a: FakeLlm = {
    id,
    calls: [],
    impl: async () => '',
    returns(t) {
      a.impl = async () => t
    },
    async complete(req) {
      a.calls.push(req)
      return {
        text: await a.impl(req),
        inputTokens: 1000,
        outputTokens: 500,
        servedModel: req.model
      }
    }
  }
  return a
}

let dir: string
let history: HistoryRepository
let files: RecordingFiles
let sttByName: Record<string, FakeStt>
let llmByName: Record<string, FakeLlm>
let stt: FakeStt
let llm: FakeLlm
let keys: Partial<Record<SecretId, string>>
let settings: Settings
let trail: Record<string, RecordingStatus[]>
let t = 0
let deps: PipelineDeps

const mode = (o: Record<string, unknown> = {}): Mode =>
  ModeSchema.parse({ id: 'm1', name: 'Mode', ...o })
const clean = mode({ ai: { enabled: true } })
const dictation = mode()

const wav = (sec: number, rate = 8000): Uint8Array => encodeWav(new Int16Array(sec * rate), rate)

const job = (m: Mode, variant: Variant = 'transform', id = 'j1'): DictationJob => ({
  id,
  createdAt: 1000,
  mode: m,
  variant,
  context: { app: { name: 'Notes', id: 'com.apple.Notes' }, clipboard: null, selection: 'sel' },
  env: { userName: 'Mark', nowIso: '2026-11-21T10:00:00Z', timeZone: 'UTC', osLocale: 'bg-BG' },
  durationMs: 2000
})

const statusTrail = (id: string): RecordingStatus[] => trail[id] ?? []

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saywrite-pipeline-'))
  history = new HistoryRepository(path.join(dir, 'history.db'))
  files = new RecordingFiles(dir)
  sttByName = {
    groq: fakeStt('groq'),
    openai: fakeStt('openai'),
    'custom-stt': fakeStt('custom-stt')
  }
  llmByName = { anthropic: fakeLlm('anthropic'), openai: fakeLlm('openai') }
  stt = sttByName.groq
  llm = llmByName.anthropic
  keys = { groq: 'gk', openai: 'ok', anthropic: 'ak' }
  settings = defaultSettings('darwin')
  settings.defaultLlm = { provider: 'anthropic', model: 'claude-sonnet-5-5' }
  trail = {}
  t = 0
  deps = {
    sttFor: (id) => sttByName[id],
    llmFor: (id) => llmByName[id],
    secrets: { get: (id) => keys[id] ?? null },
    settings: () => settings,
    vocabulary: () => ({
      schemaVersion: 1,
      terms: ['Saywrite'],
      replacements: [{ id: 'r', from: 'комит', to: 'commit', caseSensitive: false }]
    }),
    history,
    files,
    pricing: loadPricing(),
    now: () => (t += 10),
    onStatus: (id, s) => {
      ;(trail[id] ??= []).push(s)
    }
  }
  await files.writeAudio('j1', wav(2))
})

afterEach(() => {
  history.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('happy path: STT → replacements → AI → replacements', async () => {
  stt.returns('um направи комит')
  llm.returns('Направи комит.')
  const out = await runDictation(job(clean), deps)
  expect(llm.calls[0].user).toContain('направи commit')
  expect(out).toMatchObject({
    status: 'done',
    text: 'Направи commit.',
    rawText: 'um направи commit'
  })
  expect(statusTrail('j1')).toEqual(['transcribing', 'processing', 'done'])
  expect(history.get('j1')).toMatchObject({
    sttProvider: 'groq',
    llmProvider: 'anthropic',
    status: 'done',
    finalText: 'Направи commit.',
    hasAudio: true
  })
  const meta = await files.readMeta('j1')
  expect(meta).toMatchObject({ status: 'done', tokens: { input: 1000, output: 500 } })
  expect(meta?.timings.sttMs).not.toBeNull()
  expect(meta?.timings.llmMs).not.toBeNull()
  expect(history.get('j1')?.sttCostUsd).toBeGreaterThan(0)
  expect(history.get('j1')?.llmCostUsd).toBeGreaterThan(0)
})

test('dictation mode skips AI', async () => {
  stt.returns('hello комит')
  const out = await runDictation(job(dictation), deps)
  expect(out).toMatchObject({ status: 'done', text: 'hello commit', rawText: 'hello commit' })
  expect(llm.calls).toHaveLength(0)
  expect(statusTrail('j1')).toEqual(['transcribing', 'done'])
  expect(history.get('j1')?.llmProvider).toBeNull()
})

test('STT network failure keeps audio', async () => {
  stt.impl = async () => {
    throw new ProviderError('network', 'groq', 'offline')
  }
  const out = await runDictation(job(dictation), deps)
  expect(out).toMatchObject({ status: 'failed', errorKind: 'network', text: null })
  expect(history.get('j1')).toMatchObject({ status: 'failed', errorKind: 'network' })
  expect(await files.readAudio('j1')).not.toBeNull()
})

test('STT hang → timeout', async () => {
  stt.impl = (_req, signal) =>
    new Promise((_res, rej) => signal?.addEventListener('abort', () => rej(new Error('aborted'))))
  deps.timeouts = { sttBaseMs: 50, sttPerAudioSecMs: 0, llmMs: 50 }
  const out = await runDictation(job(dictation), deps)
  expect(out).toMatchObject({ status: 'failed', errorKind: 'timeout' })
})

test('STT timeout scales with audio length by default', async () => {
  stt.returns('x')
  await runDictation(job(dictation), deps)
  expect(stt.timeouts[0]).toBe(30000 + 500 * 2)
})

test('AI failure → raw fallback or failed', async () => {
  stt.returns('привет комит')
  llm.impl = async () => {
    throw new ProviderError('server', 'anthropic', 'boom', 500)
  }
  const fb = await runDictation(job(clean), deps)
  expect(fb).toMatchObject({
    status: 'done_raw_fallback',
    text: 'привет commit',
    rawText: 'привет commit',
    errorKind: 'server'
  })
  expect(statusTrail('j1')).toEqual(['transcribing', 'processing', 'done_raw_fallback'])

  settings.output.fallbackToRawOnAiError = false
  const failed = await runDictation(job(clean, 'transform', 'j1'), deps)
  expect(failed).toMatchObject({ status: 'failed', text: null, rawText: 'привет commit' })
  expect(history.get('j1')).toMatchObject({ status: 'failed', llmProvider: 'anthropic' })
})

test('cancelled AI error is never a fallback', async () => {
  stt.returns('hi')
  llm.impl = async () => {
    throw new ProviderError('network', 'anthropic', 'cancelled', undefined, { cancelled: true })
  }
  const out = await runDictation(job(clean), deps)
  expect(out.status).toBe('failed')
})

test('non-ProviderError is wrapped without leaking text', async () => {
  stt.returns('secret transcript')
  llm.impl = async () => {
    throw new Error('secret transcript exploded')
  }
  settings.output.fallbackToRawOnAiError = false
  const out = await runDictation(job(clean), deps)
  expect(out).toMatchObject({ status: 'failed', errorKind: 'server' })
  expect(out.errorMessage).not.toContain('secret')
})

test('no default LLM: transform falls back, edit fails', async () => {
  settings.defaultLlm = null
  stt.returns('hello')
  const fb = await runDictation(job(clean), deps)
  expect(fb).toMatchObject({ status: 'done_raw_fallback', text: 'hello', errorKind: 'no_llm' })
  const edit = await runDictation(job(dictation, 'edit'), deps)
  expect(edit).toMatchObject({ status: 'failed', errorKind: 'no_llm' })
})

test('edit variant runs AI even when mode.ai is disabled', async () => {
  stt.returns('make it shorter')
  llm.returns('short')
  const out = await runDictation(job(dictation, 'edit'), deps)
  expect(out).toMatchObject({ status: 'done', text: 'short' })
  expect(llm.calls[0].user).toContain('<selected_text>')
})

test('missing LLM key: transform falls back, edit fails', async () => {
  delete keys.anthropic
  stt.returns('hello')
  const fb = await runDictation(job(clean), deps)
  expect(fb).toMatchObject({ status: 'done_raw_fallback', errorKind: 'no_key' })
  expect(fb.errorMessage).toBe('No API key for Anthropic')
  const edit = await runDictation(job(dictation, 'edit'), deps)
  expect(edit).toMatchObject({ status: 'failed', errorKind: 'no_key' })
  expect(llm.calls).toHaveLength(0)
})

test('empty transcript', async () => {
  stt.returns('   ')
  const out = await runDictation(job(clean), deps)
  expect(out).toMatchObject({ status: 'empty', text: null })
  expect(llm.calls).toHaveLength(0)
  expect(statusTrail('j1')).toEqual(['transcribing', 'empty'])
  expect(history.get('j1')?.status).toBe('empty')
})

test('missing key', async () => {
  delete keys.groq
  const out = await runDictation(job(dictation), deps)
  expect(out).toMatchObject({ status: 'failed', errorKind: 'no_key' })
  expect(out.errorMessage).toContain('Groq')
  expect(stt.calls).toHaveLength(0)
})

test('custom-stt runs with an empty key', async () => {
  const sttCustom = sttByName['custom-stt']
  sttCustom.returns('ok')
  const out = await runDictation(job(mode({ stt: { provider: 'custom-stt' } })), deps)
  expect(out.status).toBe('done')
  expect(sttCustom.calls[0].apiKey).toBe('')
})

test('default provider + model resolution', async () => {
  settings.defaultStt = { provider: 'openai', model: '' }
  sttByName.openai.returns('a')
  await runDictation(job(dictation), deps)
  expect(sttByName.openai.calls[0].model).toBe('gpt-4o-mini-transcribe')
  expect(history.get('j1')).toMatchObject({
    sttProvider: 'openai',
    sttModel: 'gpt-4o-mini-transcribe'
  })

  stt.returns('b')
  await runDictation(job(mode({ stt: { provider: 'groq', model: '' } })), deps)
  expect(stt.calls[0].model).toBe('whisper-large-v3-turbo')
  expect(stt.calls[0].language).toBe('auto')
  expect(stt.calls[0].vocabulary).toEqual(['Saywrite'])
})

test('chunks long audio for OpenAI (600 s)', async () => {
  settings.defaultStt = { provider: 'openai', model: 'whisper-1' }
  await files.writeAudio('j1', wav(700))
  let n = 0
  sttByName.openai.impl = async () => `part${++n}`
  const out = await runDictation({ ...job(dictation), durationMs: 700_000 }, deps)
  expect(sttByName.openai.calls).toHaveLength(2)
  expect(out).toMatchObject({ status: 'done', text: 'part1 part2' })
  expect(history.get('j1')?.sttCostUsd).toBeCloseTo((700 / 60) * 0.006, 6)
})

test('rerun reuses raw text without re-applying replacements', async () => {
  llm.returns('Fixed комит.')
  const out = await runDictation(job(clean), deps, { reuseRawText: 'raw комит' })
  expect(stt.calls).toHaveLength(0)
  expect(out).toMatchObject({ status: 'done', rawText: 'raw комит', text: 'Fixed commit.' })
  expect(llm.calls[0].user).toContain('raw комит')
})

const firstRun = async (): Promise<void> => {
  stt.returns('hello')
  llm.returns('Hello.')
  await runDictation(job(clean), deps)
  trail = {}
}

test('rerun success keeps stt cost and adds llm cost, no intermediate statuses', async () => {
  await firstRun()
  const before = history.get('j1')!
  llm.returns('Hello again.')
  const out = await runDictation(job(clean), deps, { reuseRawText: 'hello' })
  expect(out.status).toBe('done')
  const after = history.get('j1')!
  expect(after.sttCostUsd).toBe(before.sttCostUsd)
  expect(after.llmCostUsd).toBeCloseTo(before.llmCostUsd! * 2, 9)
  expect(after).toMatchObject({ rawText: 'hello', finalText: 'Hello again.', sttProvider: 'groq' })
  expect(statusTrail('j1')).toEqual(['done'])
  const meta = await files.readMeta('j1')
  expect(meta?.timings.sttMs).not.toBeNull()
})

test('rerun failure leaves the prior row and meta untouched', async () => {
  await firstRun()
  const before = history.get('j1')
  const metaBefore = await files.readMeta('j1')
  settings.output.fallbackToRawOnAiError = false
  llm.impl = async () => {
    throw new ProviderError('server', 'anthropic', 'boom', 500)
  }
  const out = await runDictation(job(clean), deps, { reuseRawText: 'hello' })
  expect(out).toMatchObject({ status: 'failed', errorKind: 'server' })
  expect(history.get('j1')).toEqual(before)
  expect(await files.readMeta('j1')).toEqual(metaBefore)
  expect(statusTrail('j1')).toEqual([])
})

test('rerun AI error never falls back over a good result', async () => {
  await firstRun()
  const before = history.get('j1')
  const metaBefore = await files.readMeta('j1')
  expect(settings.output.fallbackToRawOnAiError).toBe(true)
  llm.impl = async () => {
    throw new ProviderError('server', 'anthropic', 'boom', 500)
  }
  const out = await runDictation(job(clean), deps, { reuseRawText: 'hello' })
  expect(out).toMatchObject({ status: 'failed', text: null, errorKind: 'server' })
  expect(history.get('j1')).toEqual(before)
  expect(await files.readMeta('j1')).toEqual(metaBefore)
})

test('rerun preserves hasAudio false when audio was deleted', async () => {
  settings.privacy.keepAudio = false
  await firstRun()
  expect(history.get('j1')?.hasAudio).toBe(false)
  settings.privacy.keepAudio = true
  llm.returns('Again.')
  await runDictation(job(clean), deps, { reuseRawText: 'hello' })
  expect(history.get('j1')?.hasAudio).toBe(false)
})

test('missing audio failure marks hasAudio false', async () => {
  await files.removeAudio('j1')
  const out = await runDictation(job(dictation), deps)
  expect(out).toMatchObject({ status: 'failed', errorKind: 'bad_request' })
  expect(history.get('j1')?.hasAudio).toBe(false)
})

test('keepAudio false: failing done write keeps the audio', async () => {
  settings.privacy.keepAudio = false
  stt.returns('hi')
  const orig = files.writeMeta.bind(files)
  files.writeMeta = async (m) => {
    if (m.status === 'done') throw new Error('disk full')
    return orig(m)
  }
  const out = await runDictation(job(dictation), deps)
  expect(out).toMatchObject({ status: 'done', text: 'hi' })
  expect(await files.readAudio('j1')).not.toBeNull()
  expect(history.get('j1')).toMatchObject({ finalText: 'hi', hasAudio: true })
})

test('removeAudio failure still yields done with hasAudio true', async () => {
  settings.privacy.keepAudio = false
  stt.returns('hi')
  files.removeAudio = async () => {
    throw new Error('EPERM')
  }
  const out = await runDictation(job(dictation), deps)
  expect(out.status).toBe('done')
  expect(history.get('j1')).toMatchObject({ status: 'done', hasAudio: true })
})

test('throwing onStatus does not break the pipeline', async () => {
  stt.returns('hi')
  deps.onStatus = () => {
    throw new Error('listener')
  }
  const out = await runDictation(job(dictation), deps)
  expect(out.status).toBe('done')
  expect(history.get('j1')?.status).toBe('done')
})

test('runAiStep only throws ProviderError', async () => {
  deps.llmFor = () => {
    throw new Error('weird')
  }
  const p = runAiStep(
    {
      mode: clean,
      variant: 'transform',
      transcript: 'x',
      context: job(clean).context,
      env: job(clean).env
    },
    deps
  )
  await expect(p).rejects.toBeInstanceOf(ProviderError)
})

test('keepAudio false removes audio only on success', async () => {
  settings.privacy.keepAudio = false
  stt.returns('hi')
  await runDictation(job(dictation), deps)
  expect(await files.readAudio('j1')).toBeNull()
  expect(history.get('j1')?.hasAudio).toBe(false)

  await files.writeAudio('j1', wav(2))
  stt.impl = async () => {
    throw new ProviderError('network', 'groq', 'offline')
  }
  await runDictation(job(dictation), deps)
  expect(await files.readAudio('j1')).not.toBeNull()
  expect(history.get('j1')?.hasAudio).toBe(true)
})

test('runAiStep returns cost and does not touch history', async () => {
  llm.returns('Out комит')
  const r = await runAiStep(
    {
      mode: clean,
      variant: 'transform',
      transcript: 'in',
      context: job(clean).context,
      env: job(clean).env
    },
    deps
  )
  expect(r).toMatchObject({
    text: 'Out commit',
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    inputTokens: 1000,
    outputTokens: 500
  })
  expect(r.costUsd).not.toBeNull()
  expect(history.get('j1')).toBeNull()
})

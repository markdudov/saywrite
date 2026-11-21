import type { LlmProviderId, ProviderErrorKind, SecretId, SttProviderId } from '@shared/providers'
import type { Mode } from '@shared/schemas/mode'
import type {
  CapturedContext,
  EnvironmentInfo,
  RecordingMeta,
  RecordingRow,
  RecordingStatus,
  Variant
} from '@shared/schemas/recording'
import type { Settings } from '@shared/schemas/settings'
import type { Vocabulary } from '@shared/schemas/vocabulary'
import { buildMessages } from '@shared/prompt/buildMessages'
import { applyReplacements } from '@shared/text/replacements'
import { decodeWav, encodeWav } from '@shared/audio/wav'
import { durationMs, splitAtSilence } from '@shared/audio/analysis'
import { llmCostUsd, sttCostUsd, type PricingTable } from '@shared/cost/pricing'
import type { HistoryRepository } from '../history/repository'
import type { RecordingFiles } from '../history/files'
import { ProviderError } from '../providers/errors'
import { providerInfo } from '../providers/catalog'
import type { SttAdapter } from '../providers/stt/openaiCompatible'
import type { LlmAdapter } from '../providers/llm/types'

export type DictationJob = {
  id: string
  createdAt: number
  mode: Mode
  variant: Variant
  context: CapturedContext
  env: EnvironmentInfo
  durationMs: number // audio already on disk
}

export type DictationOutcome = {
  status: 'done' | 'done_raw_fallback' | 'failed' | 'empty'
  text: string | null
  rawText: string | null
  errorKind: ProviderErrorKind | null
  errorMessage: string | null
}

export type PipelineDeps = {
  sttFor(id: SttProviderId): SttAdapter
  llmFor(id: LlmProviderId): LlmAdapter
  secrets: { get(id: SecretId): string | null }
  settings(): Settings
  vocabulary(): Vocabulary
  history: HistoryRepository
  files: RecordingFiles
  pricing: PricingTable
  now(): number
  onStatus?(jobId: string, status: RecordingStatus): void
  timeouts?: { sttBaseMs: number; sttPerAudioSecMs: number; llmMs: number }
}

const DEFAULT_TIMEOUTS = { sttBaseMs: 30_000, sttPerAudioSecMs: 500, llmMs: 45_000 }

type ProviderMeta = { label: string; defaultModel: string; needsKey: boolean }

function infoFor(kind: 'stt' | 'llm', id: string): ProviderMeta {
  if (id === 'local') return { label: 'Local', defaultModel: '', needsKey: false }
  const p = providerInfo(kind, id)
  return { label: p.label, defaultModel: p.defaultModel, needsKey: p.needsKey }
}

function apiKeyFor(
  kind: 'stt' | 'llm',
  id: SttProviderId | LlmProviderId,
  deps: PipelineDeps
): string {
  const info = infoFor(kind, id)
  const key = deps.secrets.get(id as SecretId) ?? ''
  if (info.needsKey && key === '') {
    throw new ProviderError('no_key', id, `No API key for ${info.label}`)
  }
  return key
}

/** Runs one adapter call with its own AbortController and a hard timeout. */
async function callWithTimeout<T>(
  provider: string,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const ctrl = new AbortController()
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      ctrl.abort()
      reject(new ProviderError('timeout', provider, `Request to ${provider} timed out`))
    }, timeoutMs)
  })
  try {
    return await Promise.race([run(ctrl.signal), timeout])
  } catch (e) {
    if (timedOut) throw new ProviderError('timeout', provider, `Request to ${provider} timed out`)
    throw normalizeError(e, provider)
  } finally {
    clearTimeout(timer)
  }
}

function normalizeError(e: unknown, provider: string): ProviderError {
  if (e instanceof ProviderError) return e
  return new ProviderError('server', provider, `Unexpected error from ${provider}`)
}

type SttTarget = { provider: SttProviderId; model: string }

function resolveStt(mode: Mode, settings: Settings): SttTarget {
  const isDefault = mode.stt.provider === 'default'
  const provider = isDefault ? settings.defaultStt.provider : (mode.stt.provider as SttProviderId)
  const model =
    mode.stt.model ||
    (isDefault ? settings.defaultStt.model : '') ||
    infoFor('stt', provider).defaultModel
  return { provider, model }
}

type LlmTarget = { provider: LlmProviderId; model: string }

function resolveLlm(mode: Mode, settings: Settings): LlmTarget {
  const isDefault = mode.ai.provider === 'default'
  const dflt = settings.defaultLlm
  if (isDefault && !dflt) {
    throw new ProviderError('no_llm', 'llm', 'No AI provider is configured')
  }
  const provider = isDefault ? dflt!.provider : (mode.ai.provider as LlmProviderId)
  const model =
    mode.ai.model || (isDefault ? dflt!.model : '') || infoFor('llm', provider).defaultModel
  return { provider, model }
}

export async function runAiStep(
  a: {
    mode: Mode
    variant: Variant
    transcript: string
    context: CapturedContext
    env: EnvironmentInfo
  },
  deps: PipelineDeps
): Promise<{
  text: string
  provider: LlmProviderId
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number | null
  ms: number
}> {
  let failedProvider: string = a.mode.ai.provider
  try {
    const target = resolveLlm(a.mode, deps.settings())
    const { provider, model } = target
    failedProvider = provider
    const apiKey = apiKeyFor('llm', provider, deps)
    const { system, user } = buildMessages({
      mode: a.mode,
      variant: a.variant,
      transcript: a.transcript,
      vocabulary: deps.vocabulary().terms,
      context: a.context,
      env: a.env
    })
    const adapter = deps.llmFor(provider)
    const timeoutMs = (deps.timeouts ?? DEFAULT_TIMEOUTS).llmMs
    const started = deps.now()
    const res = await callWithTimeout(provider, timeoutMs, (signal) =>
      adapter.complete({ model, system, user, apiKey }, { timeoutMs, signal })
    )
    const ms = deps.now() - started
    const text = applyReplacements(res.text.trim(), deps.vocabulary().replacements).trim()
    if (!text)
      throw new ProviderError(
        'empty',
        provider,
        `${infoFor('llm', provider).label} returned no text`
      )
    return {
      text,
      provider,
      model,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      costUsd: llmCostUsd(deps.pricing, provider, model, res.inputTokens, res.outputTokens),
      ms
    }
  } catch (e) {
    throw normalizeError(e, failedProvider)
  }
}

async function transcribe(
  job: DictationJob,
  target: SttTarget,
  bytes: Uint8Array,
  deps: PipelineDeps
): Promise<string> {
  const apiKey = apiKeyFor('stt', target.provider, deps)
  const adapter = deps.sttFor(target.provider)

  const t = deps.timeouts ?? DEFAULT_TIMEOUTS
  const vocabulary = deps.vocabulary().terms
  const language = job.mode.stt.language
  const call = (audio: Uint8Array, ms: number): Promise<string> => {
    const timeoutMs = t.sttBaseMs + t.sttPerAudioSecMs * (ms / 1000)
    return callWithTimeout(target.provider, timeoutMs, async (signal) => {
      const r = await adapter.transcribe(
        { audio, durationMs: ms, model: target.model, language, vocabulary, apiKey },
        { timeoutMs, signal }
      )
      return r.text
    })
  }

  let wav: { pcm: Int16Array; sampleRate: number }
  try {
    wav = decodeWav(bytes)
  } catch {
    throw new ProviderError(
      'bad_request',
      target.provider,
      'Recording audio is not a valid WAV file'
    )
  }
  const totalMs = durationMs(wav.pcm.length, wav.sampleRate)
  if (totalMs / 1000 <= adapter.maxChunkSec) return call(bytes, job.durationMs)

  const parts: string[] = []
  for (const chunk of splitAtSilence(wav.pcm, wav.sampleRate, adapter.maxChunkSec)) {
    const ms = durationMs(chunk.length, wav.sampleRate)
    parts.push((await call(encodeWav(chunk, wav.sampleRate), ms)).trim())
  }
  return parts.filter((p) => p !== '').join(' ')
}

const FINAL_OK = new Set<RecordingStatus>(['done', 'done_raw_fallback'])

export async function runDictation(
  job: DictationJob,
  deps: PipelineDeps,
  opts: { reuseRawText?: string } = {}
): Promise<DictationOutcome> {
  // Read configuration once, before any state is created.
  const settings = deps.settings()
  const vocabulary = deps.vocabulary()
  const keepAudio = settings.privacy.keepAudio
  const isRerun = opts.reuseRawText !== undefined
  const needsAi = job.mode.ai.enabled || job.variant !== 'transform'

  let sttTarget: SttTarget | null
  try {
    sttTarget = resolveStt(job.mode, settings)
  } catch {
    sttTarget = null
  }
  let llmTarget: LlmTarget | null = null
  if (needsAi) {
    try {
      llmTarget = resolveLlm(job.mode, settings)
    } catch {
      llmTarget = null
    }
  }

  const prior = isRerun ? deps.history.get(job.id) : null
  let priorMeta: RecordingMeta | null = null
  if (isRerun) {
    try {
      priorMeta = await deps.files.readMeta(job.id)
    } catch {
      priorMeta = null
    }
  }

  const row: RecordingRow = prior
    ? { ...prior }
    : {
        id: job.id,
        createdAt: job.createdAt,
        status: 'transcribing',
        modeId: job.mode.id,
        modeName: job.mode.name,
        appName: job.context.app?.name ?? null,
        appId: job.context.app?.id ?? null,
        durationMs: job.durationMs,
        rawText: null,
        finalText: null,
        sttProvider: sttTarget?.provider ?? null,
        sttModel: sttTarget?.model ?? null,
        llmProvider: null,
        llmModel: null,
        sttCostUsd: null,
        llmCostUsd: null,
        errorKind: null,
        errorMessage: null,
        hasAudio: true
      }
  const timings: RecordingMeta['timings'] = { sttMs: priorMeta?.timings.sttMs ?? null, llmMs: null }
  let tokens: RecordingMeta['tokens'] = null

  /** Writes row + meta. A rerun writes only its successful final result. */
  const persist = async (status: RecordingStatus, notify = true): Promise<void> => {
    if (isRerun && !FINAL_OK.has(status)) return
    row.status = status
    deps.history.upsert(row)
    await deps.files.writeMeta({
      ...row,
      schemaVersion: 1,
      mode: job.mode,
      variant: job.variant,
      context: job.context,
      env: job.env,
      timings,
      tokens
    })
    if (notify) {
      try {
        deps.onStatus?.(job.id, status)
      } catch {
        // a broken listener must not break the pipeline
      }
    }
  }
  /** Intermediate / terminal-failure writes never abort the pipeline. */
  const safePersist = async (status: RecordingStatus): Promise<void> => {
    try {
      await persist(status)
    } catch {
      // keep going: the dictation result matters more than the bookkeeping
    }
  }
  const outcome = (
    status: DictationOutcome['status'],
    text: string | null,
    rawText: string | null = row.rawText
  ): DictationOutcome => ({
    status,
    text,
    rawText,
    errorKind: row.errorKind,
    errorMessage: row.errorMessage
  })
  let rawForOutcome: string | null = null
  const fail = async (e: ProviderError): Promise<DictationOutcome> => {
    row.errorKind = e.kind
    row.errorMessage = e.message
    await safePersist('failed')
    return outcome('failed', null, rawForOutcome ?? row.rawText)
  }

  await safePersist('transcribing')

  // Speech to text
  let rawText: string
  if (isRerun) {
    // Reused text already went through the replacements once; do not apply them again.
    rawText = opts.reuseRawText!.trim()
    rawForOutcome = rawText
    if (!rawText) return outcome('empty', null, null)
    if (!prior) row.rawText = rawText
  } else {
    if (!sttTarget) {
      return fail(new ProviderError('bad_request', 'stt', 'Unknown speech-to-text provider'))
    }
    const started = deps.now()
    try {
      const bytes = await deps.files.readAudio(job.id)
      if (!bytes) {
        row.hasAudio = false
        throw new ProviderError('bad_request', sttTarget.provider, 'Recording audio is missing')
      }
      const raw = await transcribe(job, sttTarget, bytes, deps)
      timings.sttMs = deps.now() - started
      row.sttCostUsd = sttCostUsd(deps.pricing, sttTarget.provider, sttTarget.model, job.durationMs)
      rawText = applyReplacements(raw.trim(), vocabulary.replacements).trim()
    } catch (e) {
      return fail(normalizeError(e, sttTarget.provider))
    }
    if (!rawText) {
      await safePersist('empty')
      return outcome('empty', null)
    }
    row.rawText = rawText
  }

  const finish = async (
    status: 'done' | 'done_raw_fallback',
    text: string
  ): Promise<DictationOutcome> => {
    row.finalText = text
    if (isRerun) {
      row.modeId = job.mode.id
      row.modeName = job.mode.name
    }
    // Write the result first, with the audio still recorded as present.
    try {
      await persist(status)
    } catch {
      return outcome(status, text, rawText) // result is returned; audio stays for a later rerun
    }
    if (!keepAudio && row.hasAudio) {
      try {
        await deps.files.removeAudio(job.id)
        row.hasAudio = false
        await persist(status, false)
      } catch {
        // keep hasAudio as written; retention purge removes the file later
      }
    }
    return outcome(status, text, rawText)
  }

  if (!needsAi) return finish('done', rawText)

  // AI step
  row.llmProvider = llmTarget?.provider ?? null
  row.llmModel = llmTarget?.model ?? null
  await safePersist('processing')
  try {
    const ai = await runAiStep(
      {
        mode: job.mode,
        variant: job.variant,
        transcript: rawText,
        context: job.context,
        env: job.env
      },
      deps
    )
    row.llmProvider = ai.provider
    row.llmModel = ai.model
    row.llmCostUsd = isRerun && prior ? addCost(prior.llmCostUsd, ai.costUsd) : ai.costUsd
    timings.llmMs = ai.ms
    tokens = { input: ai.inputTokens, output: ai.outputTokens }
    row.errorKind = null
    row.errorMessage = null
    return await finish('done', ai.text)
  } catch (e) {
    const err = normalizeError(e, row.llmProvider ?? 'llm')
    if (
      !isRerun &&
      !err.cancelled &&
      job.variant === 'transform' &&
      settings.output.fallbackToRawOnAiError
    ) {
      row.errorKind = err.kind
      row.errorMessage = err.message
      return finish('done_raw_fallback', rawText)
    }
    return fail(err)
  }
}

function addCost(prior: number | null, added: number | null): number | null {
  return added === null ? prior : (prior ?? 0) + added
}

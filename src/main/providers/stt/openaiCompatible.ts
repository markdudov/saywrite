import type { SttProviderId } from '@shared/providers'
import { ProviderError } from '../errors'
import { requestJson } from '../http'
import { providerInfo } from '../catalog'

export type SttRequest = {
  audio: Uint8Array // WAV
  durationMs: number
  model: string
  language: string // 'auto' or ISO-639-1
  vocabulary: string[]
  apiKey: string
}
export type SttResult = {
  text: string
  language?: string
  segments?: { start: number; end: number; text: string }[]
}
export type SttCallOpts = { timeoutMs: number; signal?: AbortSignal }
export interface SttAdapter {
  id: SttProviderId
  maxChunkSec: number
  transcribe(req: SttRequest, opts: SttCallOpts): Promise<SttResult>
}

export function trimBase(base: string): string {
  return base.replace(/\/+$/, '')
}

export function audioForm(req: SttRequest): FormData {
  const form = new FormData()
  form.append('file', new Blob([req.audio as BlobPart], { type: 'audio/wav' }), 'audio.wav')
  return form
}

export function textOf(json: { text?: unknown } | null | undefined, provider: string): string {
  if (!json || typeof json.text !== 'string') {
    throw new ProviderError('server', provider, `Unexpected response from ${provider}`)
  }
  return json.text
}

const DEFAULT_BASES: Record<'openai' | 'groq', string> = {
  openai: 'https://api.openai.com/v1',
  groq: 'https://api.groq.com/openai/v1'
}

export function createOpenAiCompatibleAdapter(
  id: 'openai' | 'groq' | 'custom-stt',
  cfg: { baseUrl?: string } = {}
): SttAdapter {
  return {
    id,
    maxChunkSec: providerInfo('stt', id).maxChunkSec ?? 600,
    async transcribe(req, opts) {
      const configured = (cfg.baseUrl ?? '').trim()
      const base = trimBase(configured || (id === 'custom-stt' ? '' : DEFAULT_BASES[id]))
      if (!base) {
        throw new ProviderError(
          'bad_request',
          id,
          'Set a base URL for the custom speech-to-text provider'
        )
      }
      const form = audioForm(req)
      form.append('model', req.model)
      form.append('response_format', 'json')
      if (req.language !== 'auto') form.append('language', req.language)
      if (req.vocabulary.length > 0) form.append('prompt', req.vocabulary.join(', '))
      const headers: Record<string, string> = {}
      if (req.apiKey) headers.Authorization = `Bearer ${req.apiKey}`
      const json = await requestJson<{ text?: unknown }>(`${base}/audio/transcriptions`, {
        method: 'POST',
        headers,
        body: form,
        provider: id,
        timeoutMs: opts.timeoutMs,
        signal: opts.signal
      })
      return { text: textOf(json, id) }
    }
  }
}

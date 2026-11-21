import type { KeyTestResult } from '@shared/providers'
import { providerInfo } from './catalog'
import { ProviderError } from './errors'
import { requestJson } from './http'
import { listAnthropicModels } from './llm/anthropic'
import { GEMINI_BASE } from './llm/gemini'
import { openAiHeaders, resolveOpenAiBase } from './llm/openaiChat'
import { trimBase } from './stt/openaiCompatible'

const TIMEOUT_MS = 20_000

type OpenAiId = 'openai' | 'groq' | 'openrouter' | 'custom-llm' | 'custom-stt'

async function listOpenAiCompatible(
  id: OpenAiId,
  apiKey: string,
  baseUrl: string | undefined
): Promise<string[]> {
  const base =
    id === 'custom-stt'
      ? trimBase((baseUrl ?? '').trim()) ||
        (() => {
          throw new ProviderError(
            'bad_request',
            id,
            'Set a base URL for the custom speech-to-text provider'
          )
        })()
      : resolveOpenAiBase(id, baseUrl)
  const json = await requestJson<{ data?: { id?: unknown }[] }>(`${base}/models`, {
    headers: openAiHeaders(id === 'custom-stt' ? 'custom-llm' : id, apiKey),
    provider: id,
    timeoutMs: TIMEOUT_MS
  })
  return (json.data ?? []).map((m) => m.id).filter((x): x is string => typeof x === 'string')
}

async function listGemini(apiKey: string, baseUrl: string | undefined): Promise<string[]> {
  const base = trimBase(baseUrl || GEMINI_BASE)
  const json = await requestJson<{
    models?: { name?: unknown; supportedGenerationMethods?: unknown }[]
  }>(`${base}/models?pageSize=1000`, {
    headers: { 'x-goog-api-key': apiKey },
    provider: 'gemini',
    timeoutMs: TIMEOUT_MS
  })
  return (json.models ?? [])
    .filter(
      (m) =>
        typeof m.name === 'string' &&
        Array.isArray(m.supportedGenerationMethods) &&
        m.supportedGenerationMethods.includes('generateContent')
    )
    .map((m) => (m.name as string).replace(/^models\//, ''))
}

export async function listModels(
  kind: 'stt' | 'llm',
  id: string,
  apiKey: string,
  baseUrl?: string
): Promise<string[]> {
  if (kind === 'stt') {
    if (id === 'openai' || id === 'groq' || id === 'custom-stt') {
      return listOpenAiCompatible(id, apiKey, baseUrl)
    }
    return providerInfo('stt', id).recommendedModels
  }
  if (id === 'anthropic') return listAnthropicModels(apiKey)
  if (id === 'gemini') return listGemini(apiKey, baseUrl)
  if (id === 'openai' || id === 'groq' || id === 'openrouter' || id === 'custom-llm') {
    return listOpenAiCompatible(id, apiKey, baseUrl)
  }
  throw new Error(`Unknown llm provider: ${id}`)
}

export async function testKey(
  kind: 'stt' | 'llm',
  id: string,
  apiKey: string,
  baseUrl?: string
): Promise<KeyTestResult> {
  try {
    if (kind === 'stt' && id === 'deepgram') {
      const base = trimBase(baseUrl || 'https://api.deepgram.com/v1')
      await requestJson(`${base}/projects`, {
        headers: { Authorization: `Token ${apiKey}` },
        provider: id,
        timeoutMs: TIMEOUT_MS
      })
      return { ok: true, models: await listModels(kind, id, apiKey, baseUrl) }
    }
    if (kind === 'stt' && id === 'elevenlabs') {
      const base = trimBase(baseUrl || 'https://api.elevenlabs.io/v1')
      await requestJson(`${base}/user`, {
        headers: { 'xi-api-key': apiKey },
        provider: id,
        timeoutMs: TIMEOUT_MS
      })
      return { ok: true, models: await listModels(kind, id, apiKey, baseUrl) }
    }
    return { ok: true, models: await listModels(kind, id, apiKey, baseUrl) }
  } catch (e) {
    if (e instanceof ProviderError) return { ok: false, kind: e.kind, message: e.message }
    throw e
  }
}

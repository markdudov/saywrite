import type { LlmProviderId } from '@shared/providers'
import { ProviderError } from '../errors'
import { requestJson } from '../http'
import { trimBase } from '../stt/openaiCompatible'
import type { LlmAdapter } from './types'

type OpenAiLlmId = 'openai' | 'groq' | 'openrouter' | 'custom-llm'

const DEFAULT_BASES: Record<Exclude<OpenAiLlmId, 'custom-llm'>, string> = {
  openai: 'https://api.openai.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1'
}

export function reasoningEffortFor(provider: LlmProviderId, model: string): 'low' | undefined {
  if (provider === 'openai' && /^(gpt-5|o\d)/.test(model)) return 'low'
  if (provider === 'groq' && /gpt-oss/.test(model)) return 'low'
  return undefined
}

type ChatResponse = {
  model?: unknown
  choices?: { message?: { content?: unknown } }[]
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }
}

const num = (v: unknown): number => (typeof v === 'number' ? v : 0)

export function resolveOpenAiBase(id: OpenAiLlmId, baseUrl?: string): string {
  const configured = (baseUrl ?? '').trim()
  const base = trimBase(configured || (id === 'custom-llm' ? '' : DEFAULT_BASES[id]))
  if (!base) {
    throw new ProviderError('bad_request', id, 'Set a base URL for the custom AI provider')
  }
  return base
}

export function openAiHeaders(id: OpenAiLlmId, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {}
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  if (id === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/markdudov/saywrite'
    headers['X-Title'] = 'Saywrite'
  }
  return headers
}

export function createOpenAiChatAdapter(
  id: OpenAiLlmId,
  cfg: { baseUrl?: string } = {}
): LlmAdapter {
  return {
    id,
    async complete(req, opts) {
      const base = resolveOpenAiBase(id, cfg.baseUrl)
      const effort = reasoningEffortFor(id, req.model)
      const body: Record<string, unknown> = {
        model: req.model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user }
        ]
      }
      if (effort) body.reasoning_effort = effort
      const json = await requestJson<ChatResponse>(`${base}/chat/completions`, {
        method: 'POST',
        headers: { ...openAiHeaders(id, req.apiKey), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        provider: id,
        timeoutMs: opts.timeoutMs,
        signal: opts.signal
      })
      const content = json.choices?.[0]?.message?.content
      if (typeof content !== 'string' || content.trim() === '') {
        throw new ProviderError('empty', id, `${id} returned an empty completion`)
      }
      return {
        text: content,
        inputTokens: num(json.usage?.prompt_tokens),
        outputTokens: num(json.usage?.completion_tokens),
        servedModel: typeof json.model === 'string' && json.model ? json.model : req.model
      }
    }
  }
}

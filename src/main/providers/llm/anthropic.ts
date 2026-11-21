import Anthropic from '@anthropic-ai/sdk'
import { ProviderError, kindForStatus } from '../errors'
import type { LlmAdapter } from './types'

export const FALLBACK_MODELS: ReadonlySet<string> = new Set([
  'claude-fable-5-2',
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5'
])

export function supportsEffort(model: string): boolean {
  return (
    /^claude-(fable|mythos|opus|sonnet|haiku)-5/.test(model) ||
    /^claude-opus-4-[678]/.test(model) ||
    /^claude-sonnet-4-6/.test(model)
  )
}

type Reply = {
  stop_reason?: string | null
  model?: string
  content?: { type: string; text?: string }[]
  usage?: { input_tokens?: number; output_tokens?: number }
}
type Params = {
  model: string
  max_tokens: number
  system: string
  messages: { role: 'user'; content: string }[]
  output_config?: { effort: 'low' }
}
type CallOpts = { signal?: AbortSignal }

// Minimal structural view of the SDK client so tests can inject a fake.
export interface AnthropicLike {
  messages: { create(params: Params, opts?: CallOpts): Promise<Reply> }
  beta: {
    messages: {
      create(
        params: Params & { betas: string[]; fallbacks: 'default' },
        opts?: CallOpts
      ): Promise<Reply>
    }
  }
  models: { list(): AsyncIterable<{ id: string }> }
}

export function defaultAnthropicClient(apiKey: string, timeoutMs = 60_000): AnthropicLike {
  // The SDK's concrete types are far wider than AnthropicLike; narrow it here once.
  return new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 1 }) as unknown as AnthropicLike
}

export function mapAnthropicError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e
  if (e instanceof Anthropic.APIConnectionTimeoutError) {
    return new ProviderError('timeout', 'anthropic', 'Request to anthropic timed out')
  }
  if (e instanceof Anthropic.APIUserAbortError) {
    return new ProviderError('timeout', 'anthropic', 'Request to anthropic aborted', undefined, {
      cancelled: true
    })
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return new ProviderError(
      'network',
      'anthropic',
      `Network error talking to anthropic: ${e.message}`
    )
  }
  if (e instanceof Anthropic.APIError) {
    const status = typeof e.status === 'number' ? e.status : 500
    return new ProviderError(
      kindForStatus(status),
      'anthropic',
      `HTTP ${status} from anthropic: ${String(e.message).slice(0, 300)}`,
      status
    )
  }
  return new ProviderError(
    'server',
    'anthropic',
    `Unexpected error from anthropic: ${e instanceof Error ? e.message : String(e)}`
  )
}

export function createAnthropicAdapter(
  cfg: { anthropicClient?: (apiKey: string, timeoutMs: number) => AnthropicLike } = {}
): LlmAdapter {
  const make = cfg.anthropicClient ?? defaultAnthropicClient
  return {
    id: 'anthropic',
    async complete(req, opts) {
      const client = make(req.apiKey, opts.timeoutMs)
      // No temperature/top_p/top_k/thinking: rejected by current Claude models.
      const params: Params = {
        model: req.model,
        max_tokens: 16000,
        system: req.system,
        messages: [{ role: 'user', content: req.user }]
      }
      if (supportsEffort(req.model)) params.output_config = { effort: 'low' }
      let res: Reply
      try {
        res = FALLBACK_MODELS.has(req.model)
          ? await client.beta.messages.create(
              { ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' },
              { signal: opts.signal }
            )
          : await client.messages.create(params, { signal: opts.signal })
      } catch (e) {
        throw mapAnthropicError(e)
      }
      if (res.stop_reason === 'refusal') {
        throw new ProviderError(
          'refusal',
          'anthropic',
          'anthropic declined to process this request'
        )
      }
      const text = (res.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('')
      if (text.trim() === '') {
        throw new ProviderError('empty', 'anthropic', 'anthropic returned an empty completion')
      }
      return {
        text,
        inputTokens: res.usage?.input_tokens ?? 0,
        outputTokens: res.usage?.output_tokens ?? 0,
        servedModel: res.model || req.model
      }
    }
  }
}

export async function listAnthropicModels(
  apiKey: string,
  make: (apiKey: string, timeoutMs: number) => AnthropicLike = defaultAnthropicClient
): Promise<string[]> {
  const ids: string[] = []
  try {
    for await (const m of make(apiKey, 20_000).models.list()) ids.push(m.id)
  } catch (e) {
    throw mapAnthropicError(e)
  }
  return ids
}

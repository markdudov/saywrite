import type { LlmProviderId, SttProviderId } from '@shared/providers'
import type { Settings } from '@shared/schemas/settings'
import { createDeepgramAdapter } from './stt/deepgram'
import { createElevenLabsAdapter } from './stt/elevenlabs'
import { createAnthropicAdapter, type AnthropicLike } from './llm/anthropic'
import { createGeminiAdapter } from './llm/gemini'
import { createOpenAiChatAdapter } from './llm/openaiChat'
import type { LlmAdapter } from './llm/types'
import { createOpenAiCompatibleAdapter, type SttAdapter } from './stt/openaiCompatible'

export function createSttAdapter(
  id: Exclude<SttProviderId, 'local'>,
  cfg: { baseUrl?: string } = {}
): SttAdapter {
  switch (id) {
    case 'deepgram':
      return createDeepgramAdapter(cfg)
    case 'elevenlabs':
      return createElevenLabsAdapter(cfg)
    default:
      return createOpenAiCompatibleAdapter(id, cfg)
  }
}

export function sttFor(id: SttProviderId, settings: Settings): SttAdapter {
  if (id === 'local') throw new Error('Local Whisper arrives in a later update')
  return createSttAdapter(id, {
    baseUrl: id === 'custom-stt' ? settings.providers.customStt.baseUrl : undefined
  })
}

export function createLlmAdapter(
  id: LlmProviderId,
  cfg: { baseUrl?: string; anthropicClient?: (apiKey: string) => AnthropicLike } = {}
): LlmAdapter {
  switch (id) {
    case 'anthropic':
      return createAnthropicAdapter({ anthropicClient: cfg.anthropicClient })
    case 'gemini':
      return createGeminiAdapter(cfg)
    default:
      return createOpenAiChatAdapter(id, cfg)
  }
}

export function llmFor(id: LlmProviderId, settings: Settings): LlmAdapter {
  return createLlmAdapter(id, {
    baseUrl: id === 'custom-llm' ? settings.providers.customLlm.baseUrl : undefined
  })
}

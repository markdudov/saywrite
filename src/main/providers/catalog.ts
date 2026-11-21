import type { LlmProviderId, SttProviderId } from '@shared/providers'

export type ProviderInfo = {
  id: SttProviderId | LlmProviderId
  kind: 'stt' | 'llm'
  label: string
  keyUrl: string | null
  needsKey: boolean
  needsBaseUrl: boolean
  defaultModel: string
  recommendedModels: string[]
  maxChunkSec?: number
}

// Model names verified against provider docs on 2026-11-21.
export const CATALOG: ProviderInfo[] = [
  {
    id: 'openai',
    kind: 'stt',
    label: 'OpenAI',
    keyUrl: 'https://platform.openai.com/api-keys',
    needsKey: true,
    needsBaseUrl: false,
    defaultModel: 'gpt-4o-mini-transcribe',
    recommendedModels: ['gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1'],
    maxChunkSec: 600
  },
  {
    id: 'groq',
    kind: 'stt',
    label: 'Groq',
    keyUrl: 'https://console.groq.com/keys',
    needsKey: true,
    needsBaseUrl: false,
    defaultModel: 'whisper-large-v3-turbo',
    recommendedModels: ['whisper-large-v3-turbo', 'whisper-large-v3'],
    maxChunkSec: 600
  },
  {
    id: 'deepgram',
    kind: 'stt',
    label: 'Deepgram',
    keyUrl: 'https://console.deepgram.com',
    needsKey: true,
    needsBaseUrl: false,
    defaultModel: 'nova-3',
    recommendedModels: ['nova-3', 'nova-2'],
    maxChunkSec: 3600
  },
  {
    id: 'elevenlabs',
    kind: 'stt',
    label: 'ElevenLabs',
    keyUrl: 'https://elevenlabs.io/app/settings/api-keys',
    needsKey: true,
    needsBaseUrl: false,
    defaultModel: 'scribe_v2',
    recommendedModels: ['scribe_v2', 'scribe_v3'],
    maxChunkSec: 3600
  },
  {
    id: 'custom-stt',
    kind: 'stt',
    label: 'Custom (OpenAI-compatible)',
    keyUrl: null,
    needsKey: false,
    needsBaseUrl: true,
    defaultModel: 'whisper-1',
    recommendedModels: [],
    maxChunkSec: 600
  },
  {
    id: 'openai',
    kind: 'llm',
    label: 'OpenAI',
    keyUrl: 'https://platform.openai.com/api-keys',
    needsKey: true,
    needsBaseUrl: false,
    defaultModel: 'gpt-5-mini',
    recommendedModels: ['gpt-5-mini', 'gpt-5']
  },
  {
    id: 'anthropic',
    kind: 'llm',
    label: 'Anthropic',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    needsKey: true,
    needsBaseUrl: false,
    defaultModel: 'claude-opus-5-5',
    recommendedModels: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']
  },
  {
    id: 'gemini',
    kind: 'llm',
    label: 'Google Gemini',
    keyUrl: 'https://aistudio.google.com/apikey',
    needsKey: true,
    needsBaseUrl: false,
    defaultModel: 'gemini-3.8-flash',
    recommendedModels: ['gemini-3.8-flash', 'gemini-3.1-pro-preview']
  },
  {
    id: 'groq',
    kind: 'llm',
    label: 'Groq',
    keyUrl: 'https://console.groq.com/keys',
    needsKey: true,
    needsBaseUrl: false,
    defaultModel: 'openai/gpt-oss-120b',
    recommendedModels: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b']
  },
  {
    id: 'openrouter',
    kind: 'llm',
    label: 'OpenRouter',
    keyUrl: 'https://openrouter.ai/keys',
    needsKey: true,
    needsBaseUrl: false,
    defaultModel: '',
    recommendedModels: []
  },
  {
    id: 'custom-llm',
    kind: 'llm',
    label: 'Custom (OpenAI-compatible, e.g. Ollama)',
    keyUrl: null,
    needsKey: false,
    needsBaseUrl: true,
    defaultModel: '',
    recommendedModels: []
  }
]

export function providerInfo(kind: 'stt' | 'llm', id: string): ProviderInfo {
  const p = CATALOG.find((c) => c.kind === kind && c.id === id)
  if (!p) throw new Error(`Unknown ${kind} provider: ${id}`)
  return p
}

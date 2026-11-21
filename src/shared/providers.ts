export type SttProviderId = 'openai' | 'groq' | 'deepgram' | 'elevenlabs' | 'custom-stt' | 'local'
export type LlmProviderId = 'openai' | 'anthropic' | 'gemini' | 'groq' | 'openrouter' | 'custom-llm'
export type SecretId =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'groq'
  | 'openrouter'
  | 'deepgram'
  | 'elevenlabs'
  | 'custom-stt'
  | 'custom-llm'

export type ProviderStatus = {
  id: SttProviderId | LlmProviderId
  kinds: ('stt' | 'llm')[]
  hasKey: boolean
  maskedKey: string | null
  baseUrl?: string
}

export type ProviderErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'network'
  | 'timeout'
  | 'bad_request'
  | 'server'
  | 'refusal'
  | 'empty'
  | 'no_key'
  | 'no_llm'

export type KeyTestResult =
  { ok: true; models: string[] } | { ok: false; kind: ProviderErrorKind; message: string }

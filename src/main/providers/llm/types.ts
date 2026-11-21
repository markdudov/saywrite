import type { LlmProviderId } from '@shared/providers'

export type LlmRequest = { model: string; system: string; user: string; apiKey: string }
export type LlmResult = {
  text: string
  inputTokens: number
  outputTokens: number
  servedModel: string
}
export type LlmCallOpts = { timeoutMs: number; signal?: AbortSignal }
export interface LlmAdapter {
  id: LlmProviderId
  complete(req: LlmRequest, opts: LlmCallOpts): Promise<LlmResult>
}

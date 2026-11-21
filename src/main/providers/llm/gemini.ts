import { ProviderError } from '../errors'
import { requestJson } from '../http'
import { trimBase } from '../stt/openaiCompatible'
import type { LlmAdapter } from './types'

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: unknown }[] } }[]
  usageMetadata?: {
    promptTokenCount?: unknown
    candidatesTokenCount?: unknown
    thoughtsTokenCount?: unknown
  }
}

const num = (v: unknown): number => (typeof v === 'number' ? v : 0)

export function createGeminiAdapter(cfg: { baseUrl?: string } = {}): LlmAdapter {
  const base = trimBase(cfg.baseUrl || GEMINI_BASE)
  return {
    id: 'gemini',
    async complete(req, opts) {
      const json = await requestJson<GeminiResponse>(
        `${base}/models/${encodeURIComponent(req.model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'x-goog-api-key': req.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: req.system }] },
            contents: [{ role: 'user', parts: [{ text: req.user }] }]
          }),
          provider: 'gemini',
          timeoutMs: opts.timeoutMs,
          signal: opts.signal
        }
      )
      const parts = json.candidates?.[0]?.content?.parts ?? []
      const text = parts.map((p) => (typeof p.text === 'string' ? p.text : '')).join('')
      if (text.trim() === '') {
        throw new ProviderError('empty', 'gemini', 'gemini returned an empty completion')
      }
      const u = json.usageMetadata
      return {
        text,
        inputTokens: num(u?.promptTokenCount),
        outputTokens: num(u?.candidatesTokenCount) + num(u?.thoughtsTokenCount),
        servedModel: req.model
      }
    }
  }
}

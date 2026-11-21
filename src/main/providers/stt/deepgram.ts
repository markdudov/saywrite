import { ProviderError } from '../errors'
import { requestJson } from '../http'
import { providerInfo } from '../catalog'
import { trimBase, type SttAdapter } from './openaiCompatible'

type DeepgramResponse = {
  results?: { channels?: { alternatives?: { transcript?: unknown }[] }[] }
}

export function createDeepgramAdapter(cfg: { baseUrl?: string } = {}): SttAdapter {
  const base = trimBase(cfg.baseUrl || 'https://api.deepgram.com/v1')
  return {
    id: 'deepgram',
    maxChunkSec: providerInfo('stt', 'deepgram').maxChunkSec ?? 3600,
    async transcribe(req, opts) {
      const q = new URLSearchParams({
        model: req.model,
        smart_format: 'true',
        punctuate: 'true'
      })
      if (req.language === 'auto') q.set('detect_language', 'true')
      else q.set('language', req.language)
      if (req.model.startsWith('nova-3')) {
        for (const term of req.vocabulary) q.append('keyterm', term)
      }
      const json = await requestJson<DeepgramResponse>(`${base}/listen?${q.toString()}`, {
        method: 'POST',
        headers: { Authorization: `Token ${req.apiKey}`, 'Content-Type': 'audio/wav' },
        body: req.audio as BodyInit,
        provider: 'deepgram',
        timeoutMs: opts.timeoutMs,
        signal: opts.signal
      })
      const text = json?.results?.channels?.[0]?.alternatives?.[0]?.transcript
      if (typeof text !== 'string') {
        throw new ProviderError('server', 'deepgram', 'Unexpected response from deepgram')
      }
      return { text }
    }
  }
}

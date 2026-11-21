import { requestJson } from '../http'
import { providerInfo } from '../catalog'
import { audioForm, textOf, trimBase, type SttAdapter } from './openaiCompatible'

export function createElevenLabsAdapter(cfg: { baseUrl?: string } = {}): SttAdapter {
  const base = trimBase(cfg.baseUrl || 'https://api.elevenlabs.io/v1')
  return {
    id: 'elevenlabs',
    maxChunkSec: providerInfo('stt', 'elevenlabs').maxChunkSec ?? 3600,
    async transcribe(req, opts) {
      const form = audioForm(req)
      form.append('model_id', req.model)
      if (req.language !== 'auto') form.append('language_code', req.language)
      form.append('tag_audio_events', 'false')
      const json = await requestJson<{ text?: unknown }>(`${base}/speech-to-text`, {
        method: 'POST',
        headers: { 'xi-api-key': req.apiKey },
        body: form,
        provider: 'elevenlabs',
        timeoutMs: opts.timeoutMs,
        signal: opts.signal
      })
      return { text: textOf(json, 'elevenlabs') }
    }
  }
}

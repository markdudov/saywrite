import type { SttProviderId } from '@shared/providers'
import type { Settings } from '@shared/schemas/settings'
import { createDeepgramAdapter } from './stt/deepgram'
import { createElevenLabsAdapter } from './stt/elevenlabs'
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

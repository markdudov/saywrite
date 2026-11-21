import { z } from 'zod'
import { KEY } from '../keys'
import type { Platform } from '../platform'
import { HotkeySchema } from './mode'

const SttProviderEnum = z.enum(['openai', 'groq', 'deepgram', 'elevenlabs', 'custom-stt', 'local'])
const LlmProviderEnum = z.enum([
  'openai',
  'anthropic',
  'gemini',
  'groq',
  'openrouter',
  'custom-llm'
])

export const SettingsSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  uiLanguage: z.enum(['system', 'en', 'bg']).default('system'),
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  launchAtLogin: z.boolean().default(true),
  sounds: z.boolean().default(true),
  userName: z.string().default(''),
  activeModeId: z.string().default('builtin-dictation'),
  hotkeys: z.object({
    dictate: HotkeySchema,
    edit: HotkeySchema.nullable().default(null),
    holdThresholdMs: z.number().int().min(150).max(1000).default(300),
    paused: z.boolean().default(false)
  }),
  defaultStt: z
    .object({ provider: SttProviderEnum, model: z.string() })
    .default({ provider: 'groq', model: 'whisper-large-v3-turbo' }),
  defaultLlm: z.object({ provider: LlmProviderEnum, model: z.string() }).nullable().default(null),
  providers: z
    .object({
      customStt: z.object({ baseUrl: z.string().default('') }).prefault({}),
      customLlm: z.object({ baseUrl: z.string().default('') }).prefault({})
    })
    .prefault({}),
  audio: z
    .object({
      inputDeviceId: z.string().default('default'),
      trimSilence: z.boolean().default(true)
    })
    .prefault({}),
  output: z
    .object({
      restoreClipboard: z.boolean().default(true),
      pasteDelayMs: z.number().int().min(20).max(1000).default(80),
      restoreDelayMs: z.number().int().min(100).max(3000).default(400),
      fallbackToRawOnAiError: z.boolean().default(true)
    })
    .prefault({}),
  privacy: z
    .object({
      retention: z.enum(['forever', '90d', '30d', '7d']).default('forever'),
      keepAudio: z.boolean().default(true)
    })
    .prefault({}),
  overlay: z
    .object({
      x: z.number().nullable().default(null),
      y: z.number().nullable().default(null)
    })
    .prefault({})
})
export type Settings = z.infer<typeof SettingsSchema>

export function defaultSettings(p: Platform): Settings {
  const mac = p === 'darwin'
  return SettingsSchema.parse({
    hotkeys: {
      dictate: { keys: mac ? [KEY.AltRight] : [KEY.Ctrl, KEY.Meta] },
      edit: { keys: mac ? [KEY.Shift, KEY.AltRight] : [KEY.Shift, KEY.Ctrl, KEY.Meta] }
    }
  })
}

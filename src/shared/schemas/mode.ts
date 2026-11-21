import { z } from 'zod'

export const HotkeySchema = z.object({ keys: z.array(z.number().int()).min(1).max(4) })
export type Hotkey = z.infer<typeof HotkeySchema>

export const AppRefSchema = z.object({
  name: z.string().min(1),
  macBundleId: z.string().optional(),
  winExeName: z.string().optional()
})
export type AppRef = z.infer<typeof AppRefSchema>

const SttIds = ['openai', 'groq', 'deepgram', 'elevenlabs', 'custom-stt', 'local'] as const
const LlmIds = ['openai', 'anthropic', 'gemini', 'groq', 'openrouter', 'custom-llm'] as const

export const OutputActionSchema = z.enum(['paste', 'copy', 'replaceSelection'])
export type OutputAction = z.infer<typeof OutputActionSchema>

export const ModeSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string().min(1),
  name: z.string().min(1).max(60),
  icon: z.string().default('mic'),
  description: z.string().default(''),
  builtin: z
    .enum(['dictation', 'clean', 'message', 'email', 'prompt', 'translate', 'edit'])
    .nullable()
    .default(null),
  hotkey: HotkeySchema.nullable().default(null),
  stt: z
    .object({
      provider: z.enum(['default', ...SttIds]).default('default'),
      model: z.string().default(''),
      language: z.string().default('auto')
    })
    .prefault({}),
  ai: z
    .object({
      enabled: z.boolean().default(false),
      provider: z.enum(['default', ...LlmIds]).default('default'),
      model: z.string().default(''),
      instructions: z.string().default(''),
      examples: z.array(z.object({ input: z.string(), output: z.string() })).default([])
    })
    .prefault({}),
  translateTo: z.string().nullable().default(null),
  context: z
    .object({
      activeApp: z.boolean().default(true),
      selection: z.boolean().default(false),
      clipboard: z.boolean().default(false)
    })
    .prefault({}),
  output: z
    .object({
      action: OutputActionSchema.default('paste'),
      pressEnter: z.boolean().default(false)
    })
    .prefault({}),
  activation: z.object({ apps: z.array(AppRefSchema).default([]) }).prefault({}),
  order: z.number().int().default(0)
})
export type Mode = z.infer<typeof ModeSchema>

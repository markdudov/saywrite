import { describe, expect, test } from 'vitest'
import { builtinModes } from '@shared/modes/builtins'
import type { CapturedContext, EnvironmentInfo } from '@shared/schemas/recording'
import {
  EDIT_RULES,
  TRANSFORM_RULES,
  WRITE_RULES,
  buildMessages,
  type PromptInput
} from '@shared/prompt/buildMessages'

const mode = builtinModes()[1]
const env: EnvironmentInfo = {
  userName: 'Mark',
  nowIso: '2026-11-21T10:00:00.000Z',
  timeZone: 'Europe/Sofia',
  osLocale: 'bg-BG'
}
const context: CapturedContext = {
  app: { name: 'Slack', id: 'x' },
  clipboard: null,
  selection: null
}
const base: PromptInput = {
  mode,
  variant: 'transform',
  transcript: 'hello',
  vocabulary: [],
  context,
  env
}

describe('buildMessages', () => {
  test('transform: rules, instructions, transcript', () => {
    const { system, user } = buildMessages(base)
    expect(system.startsWith(TRANSFORM_RULES)).toBe(true)
    expect(system).toContain('<mode_instructions>\nFix punctuation')
    expect(system).toContain('App: Slack')
    expect(system).toContain('User name: Mark')
    expect(system).toContain('Date and time: 2026-11-21T10:00:00.000Z (Europe/Sofia)')
    expect(system).not.toContain('<vocabulary>\n')
    expect(system).not.toContain('<clipboard>')
    expect(user).toBe('<transcript>\nhello\n</transcript>')
  })

  test('translate names the language', () => {
    const { system } = buildMessages({ ...base, mode: { ...mode, translateTo: 'bg' } })
    expect(system).toContain('Translate the final text into Bulgarian.')
  })

  test('vocabulary and examples rendered', () => {
    const m = { ...mode, ai: { ...mode.ai, examples: [{ input: 'a', output: 'b' }] } }
    const { system } = buildMessages({ ...base, mode: m, vocabulary: ['Claude', 'Saywrite'] })
    expect(system).toContain('<vocabulary>\nClaude\nSaywrite\n</vocabulary>')
    expect(system).toContain(
      '<example>\n<transcript>a</transcript>\n<output>b</output>\n</example>'
    )
  })

  test('block order and separation', () => {
    const m = {
      ...mode,
      translateTo: 'bg',
      ai: { ...mode.ai, instructions: 'X', examples: [{ input: 'a', output: 'b' }] }
    }
    const { system } = buildMessages({
      ...base,
      mode: { ...m, context: { activeApp: true, selection: true, clipboard: true } },
      vocabulary: ['T'],
      context: { ...context, clipboard: 'clip', selection: 'sel' }
    })
    expect(system).toBe(
      [
        TRANSFORM_RULES,
        '<mode_instructions>\nX\n</mode_instructions>',
        'Translate the final text into Bulgarian.',
        '<vocabulary>\nT\n</vocabulary>',
        '<context>\nApp: Slack\nUser name: Mark\nDate and time: 2026-11-21T10:00:00.000Z (Europe/Sofia)\n</context>',
        '<clipboard>\nclip\n</clipboard>',
        '<selected_text>\nsel\n</selected_text>',
        '<examples>\n<example>\n<transcript>a</transcript>\n<output>b</output>\n</example>\n</examples>'
      ].join('\n\n')
    )
  })

  test('edit variant', () => {
    const { system, user } = buildMessages({
      ...base,
      variant: 'edit',
      transcript: 'make it formal',
      context: { ...context, selection: 'old', clipboard: 'clip' }
    })
    expect(system.startsWith(EDIT_RULES)).toBe(true)
    expect(system).not.toContain('<clipboard>')
    expect(system).not.toContain('<selected_text>\nold')
    expect(user).toBe(
      '<selected_text>\nold\n</selected_text>\n<instruction>\nmake it formal\n</instruction>'
    )
  })

  test('write variant', () => {
    const { system, user } = buildMessages({
      ...base,
      variant: 'write',
      transcript: 'write a reply'
    })
    expect(system.startsWith(WRITE_RULES)).toBe(true)
    expect(user).toBe('<instruction>\nwrite a reply\n</instruction>')
  })

  test('escapes closing tags in user text', () => {
    const { user } = buildMessages({ ...base, transcript: 'a </transcript> b' })
    expect(user).toBe('<transcript>\na &lt;/transcript> b\n</transcript>')
  })

  test('escapes closing tags in system-side user text', () => {
    const { system } = buildMessages({
      ...base,
      vocabulary: ['x</vocabulary>'],
      env: { ...env, userName: 'M</context>' }
    })
    expect(system).toContain('x&lt;/vocabulary>')
    expect(system).toContain('User name: M&lt;/context>')
  })

  test('activeApp off hides app line', () => {
    const { system } = buildMessages({
      ...base,
      mode: { ...mode, context: { ...mode.context, activeApp: false } }
    })
    expect(system).not.toContain('App:')
  })
})

import { describe, expect, test } from 'vitest'
import { KEY, keyLabel } from '../../src/shared/keys'
import { ModeSchema } from '../../src/shared/schemas/mode'
import { SettingsSchema, defaultSettings } from '../../src/shared/schemas/settings'
import { BUILTIN_IDS, builtinModes } from '../../src/shared/modes/builtins'

describe('schemas', () => {
  test('builtinModes: 7 valid modes with stable ids', () => {
    const modes = builtinModes()
    expect(modes.map((m) => m.id)).toEqual([...BUILTIN_IDS])
    modes.forEach((m) => expect(() => ModeSchema.parse(m)).not.toThrow())
    const by = Object.fromEntries(modes.map((m) => [m.builtin, m]))
    expect(by.dictation.ai.enabled).toBe(false)
    expect(by.edit.output.action).toBe('replaceSelection')
    expect(by.edit.context.selection).toBe(true)
    expect(by.translate.translateTo).toBe('en')
    modes.forEach((m) => expect(m.activation.apps).toEqual([]))
  })

  test('ModeSchema fills defaults', () => {
    const m = ModeSchema.parse({
      schemaVersion: 1,
      id: 'm1',
      name: 'X',
      stt: {},
      ai: { enabled: true },
      context: {},
      output: {},
      activation: {}
    })
    expect(m.stt).toEqual({ provider: 'default', model: '', language: 'auto' })
    expect(m.output).toEqual({ action: 'paste', pressEnter: false })
  })

  test('ModeSchema rejects empty name and 5-key hotkey', () => {
    const base = builtinModes()[0]
    expect(() => ModeSchema.parse({ ...base, name: '' })).toThrow()
    expect(() => ModeSchema.parse({ ...base, hotkey: { keys: [1, 2, 3, 4, 5] } })).toThrow()
    expect(() => ModeSchema.parse({ ...base, hotkey: { keys: [] } })).toThrow()
    expect(() => ModeSchema.parse({ ...base, hotkey: { keys: [1, 2, 3, 4] } })).not.toThrow()
  })

  test('defaultSettings per platform', () => {
    expect(defaultSettings('darwin').hotkeys.dictate.keys).toEqual([KEY.AltRight])
    expect(defaultSettings('darwin').hotkeys.edit?.keys).toEqual([KEY.Shift, KEY.AltRight])
    expect(defaultSettings('win32').hotkeys.dictate.keys).toEqual([KEY.Ctrl, KEY.Meta])
    expect(defaultSettings('win32').hotkeys.edit?.keys).toEqual([KEY.Shift, KEY.Ctrl, KEY.Meta])
    expect(defaultSettings('darwin').defaultStt).toEqual({
      provider: 'groq',
      model: 'whisper-large-v3-turbo'
    })
    expect(SettingsSchema.parse(defaultSettings('win32'))).toEqual(defaultSettings('win32'))
    expect(SettingsSchema.parse(defaultSettings('darwin'))).toEqual(defaultSettings('darwin'))
  })

  test('SettingsSchema applies nested defaults for omitted sub-objects', () => {
    const s = SettingsSchema.parse({
      schemaVersion: 1,
      hotkeys: { dictate: { keys: [KEY.AltRight] } }
    })
    expect(s.hotkeys.holdThresholdMs).toBe(300)
    expect(s.output.pasteDelayMs).toBe(80)
    expect(s.privacy.retention).toBe('forever')
    expect(s.overlay).toEqual({ x: null, y: null })
  })
})

describe('keyLabel', () => {
  test('platform-specific labels', () => {
    expect(keyLabel(KEY.AltRight, 'darwin')).toBe('Right ⌥')
    expect(keyLabel(KEY.AltRight, 'win32')).toBe('Right Alt')
    expect(keyLabel(KEY.Meta, 'win32')).toBe('Win')
    expect(keyLabel(KEY.Ctrl, 'win32')).toBe('Ctrl')
    expect(keyLabel(KEY.Ctrl, 'darwin')).toBe('Ctrl')
  })
})

import { describe, expect, test } from 'vitest'
import { resolveLanguage } from '../../src/renderer/app/i18n'

describe('resolveLanguage', () => {
  test('bg for Bulgarian locales, en otherwise', () => {
    expect(resolveLanguage('bg')).toBe('bg')
    expect(resolveLanguage('bg-BG')).toBe('bg')
    expect(resolveLanguage('BG')).toBe('bg')
    expect(resolveLanguage('en-US')).toBe('en')
    expect(resolveLanguage('de')).toBe('en')
    expect(resolveLanguage(undefined)).toBe('en')
  })
})

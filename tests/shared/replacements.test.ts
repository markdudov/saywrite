import { describe, expect, test } from 'vitest'
import { applyReplacements, normalizeTerms } from '../../src/shared/text/replacements'
import type { Replacement } from '../../src/shared/schemas/vocabulary'

const r = (from: string, to: string, caseSensitive = false): Replacement => ({
  id: from,
  from,
  to,
  caseSensitive
})

describe('applyReplacements', () => {
  test('Cyrillic whole word, case-insensitive', () =>
    expect(applyReplacements('Направи Комит и комитни', [r('комит', 'commit')])).toBe(
      'Направи commit и комитни'
    ))
  test('regex specials escaped', () => {
    expect(applyReplacements('I like c++ code', [r('c++', 'C++')])).toBe('I like C++ code')
    expect(applyReplacements('nodexjs', [r('node.js', 'Node.js')])).toBe('nodexjs')
  })
  test('multi-word phrase with flexible spaces', () =>
    expect(applyReplacements('use open   ai api', [r('open ai', 'OpenAI')])).toBe('use OpenAI api'))
  test('longest rule first', () =>
    expect(
      applyReplacements('type script and script', [
        r('script', 'SCRIPT'),
        r('type script', 'TypeScript')
      ])
    ).toBe('TypeScript and SCRIPT'))
  test('caseSensitive respected', () =>
    expect(applyReplacements('Go go', [r('go', 'Go!', true)])).toBe('Go Go!'))
  test('empty from ignored', () => expect(applyReplacements('x', [r('', 'y')])).toBe('x'))
  test('replacement text with $ is literal', () =>
    expect(applyReplacements('price', [r('price', '$& $1')])).toBe('$& $1'))
})

describe('normalizeTerms', () => {
  test('trim, drop empty, dedupe', () =>
    expect(normalizeTerms([' Claude ', 'claude', '', 'Saywrite'])).toEqual(['Claude', 'Saywrite']))
  test('caps at 500', () =>
    expect(normalizeTerms(Array.from({ length: 600 }, (_, i) => `t${i}`))).toHaveLength(500))
})

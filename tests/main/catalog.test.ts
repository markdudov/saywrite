import { describe, expect, test } from 'vitest'
import { CATALOG, providerInfo } from '../../src/main/providers/catalog'
import { llmCostUsd, loadPricing, sttCostUsd } from '../../src/shared/cost/pricing'

describe('catalog', () => {
  test('every default/recommended model has a price', () => {
    const t = loadPricing()
    for (const p of CATALOG) {
      if (p.id === 'custom-stt' || p.id === 'custom-llm' || p.id === 'openrouter') continue
      for (const m of new Set([p.defaultModel, ...p.recommendedModels])) {
        const cost =
          p.kind === 'stt'
            ? sttCostUsd(t, p.id, m, 60_000)
            : llmCostUsd(t, p.id, m, 1_000_000, 1_000_000)
        expect(cost, `${p.kind}/${p.id}/${m}`).not.toBeNull()
      }
    }
  })
  test('providerInfo looks up by kind and id', () => {
    expect(providerInfo('llm', 'anthropic').defaultModel).toBe('claude-opus-5-5')
    expect(() => providerInfo('stt', 'nope')).toThrow()
  })
})

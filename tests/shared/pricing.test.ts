import { expect, test } from 'vitest'
import {
  PricingTableSchema,
  llmCostUsd,
  loadPricing,
  sttCostUsd,
  type PricingTable
} from '../../src/shared/cost/pricing'

const t: PricingTable = {
  updated: '2026-11-21',
  entries: [
    { kind: 'stt', provider: 'groq', model: 'whisper-large-v3-turbo', usdPerMinute: 0.000667 },
    { kind: 'stt', provider: 'openai', model: 'gpt-4o-mini-transcribe', usdPerMinute: 0.003 },
    { kind: 'stt', provider: 'openai', model: 'gpt-4o', usdPerMinute: 0.5 },
    {
      kind: 'llm',
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
      usdPerMTokIn: 0.1,
      usdPerMTokOut: 0.5
    }
  ]
}

test('stt per minute', () =>
  expect(sttCostUsd(t, 'groq', 'whisper-large-v3-turbo', 90_000)).toBeCloseTo(0.000667 * 1.5, 9))
test('llm per token', () =>
  expect(llmCostUsd(t, 'anthropic', 'claude-haiku-5-5', 1000, 200)).toBeCloseTo(0.0002, 10))
test('prefix match', () =>
  expect(sttCostUsd(t, 'openai', 'gpt-4o-mini-transcribe-2026-01-01', 60_000)).toBeCloseTo(
    0.003,
    9
  ))
test('longest prefix wins', () =>
  expect(sttCostUsd(t, 'openai', 'gpt-4o-mini-transcribe', 60_000)).toBeCloseTo(0.003, 9))
test('unknown → null, local → 0', () => {
  expect(llmCostUsd(t, 'openai', 'nope', 1, 1)).toBeNull()
  expect(sttCostUsd(t, 'local', 'base', 60_000)).toBe(0)
  expect(llmCostUsd(t, 'anthropic', 'claude-haiku-5-5', 1, 1)).not.toBeNull()
  expect(sttCostUsd(t, 'anthropic', 'claude-haiku-5-5', 1)).toBeNull()
})
test('bundled table is valid', () =>
  expect(() => PricingTableSchema.parse(loadPricing())).not.toThrow())

import { z } from 'zod'
import bundled from './pricing.json'

const SttEntrySchema = z.object({
  kind: z.literal('stt'),
  provider: z.string(),
  model: z.string(),
  usdPerMinute: z.number().nonnegative()
})
const LlmEntrySchema = z.object({
  kind: z.literal('llm'),
  provider: z.string(),
  model: z.string(),
  usdPerMTokIn: z.number().nonnegative(),
  usdPerMTokOut: z.number().nonnegative()
})

export const PriceEntrySchema = z.discriminatedUnion('kind', [SttEntrySchema, LlmEntrySchema])
export const PricingTableSchema = z.object({
  updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entries: z.array(PriceEntrySchema)
})

export type PriceEntry = z.infer<typeof PriceEntrySchema>
export type PricingTable = z.infer<typeof PricingTableSchema>

export function loadPricing(): PricingTable {
  return PricingTableSchema.parse(bundled)
}

function find<K extends PriceEntry['kind']>(
  t: PricingTable,
  kind: K,
  provider: string,
  model: string
): Extract<PriceEntry, { kind: K }> | null {
  let best: PriceEntry | null = null
  for (const e of t.entries) {
    if (e.kind !== kind || e.provider !== provider || !model.startsWith(e.model)) continue
    if (!best || e.model.length > best.model.length) best = e
  }
  return best as Extract<PriceEntry, { kind: K }> | null
}

export function sttCostUsd(
  t: PricingTable,
  provider: string,
  model: string,
  durationMs: number
): number | null {
  if (provider === 'local') return 0
  const e = find(t, 'stt', provider, model)
  return e ? (durationMs / 60_000) * e.usdPerMinute : null
}

export function llmCostUsd(
  t: PricingTable,
  provider: string,
  model: string,
  inTok: number,
  outTok: number
): number | null {
  if (provider === 'local') return 0
  const e = find(t, 'llm', provider, model)
  return e ? (inTok * e.usdPerMTokIn + outTok * e.usdPerMTokOut) / 1_000_000 : null
}

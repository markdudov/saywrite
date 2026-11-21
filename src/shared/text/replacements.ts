import type { Replacement } from '../schemas/vocabulary'

const MAX_TERMS = 500

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Applies replacement rules, longest `from` first, on Unicode word boundaries. */
export function applyReplacements(text: string, rules: Replacement[]): string {
  const active = rules.filter((rule) => rule.from.trim() !== '')
  active.sort((a, b) => b.from.length - a.from.length)
  let out = text
  for (const rule of active) {
    const body = rule.from.trim().split(/\s+/).map(escapeRegex).join('\\s+')
    const re = new RegExp(
      `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`,
      rule.caseSensitive ? 'gu' : 'giu'
    )
    out = out.replace(re, () => rule.to)
  }
  return out
}

/** Trim, drop empty, dedupe case-insensitively (first wins), cap at 500. */
export function normalizeTerms(terms: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of terms) {
    const term = raw.trim()
    if (!term) continue
    const key = term.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(term)
    if (result.length >= MAX_TERMS) break
  }
  return result
}

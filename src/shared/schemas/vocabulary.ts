import { z } from 'zod'

export const ReplacementSchema = z.object({
  id: z.string(),
  from: z.string().min(1),
  to: z.string(),
  caseSensitive: z.boolean().default(false)
})
export type Replacement = z.infer<typeof ReplacementSchema>

export const VocabularySchema = z.object({
  schemaVersion: z.literal(1).default(1),
  terms: z.array(z.string()).default([]),
  replacements: z.array(ReplacementSchema).default([])
})
export type Vocabulary = z.infer<typeof VocabularySchema>

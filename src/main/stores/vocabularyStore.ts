import { normalizeTerms } from '@shared/text/replacements'
import { VocabularySchema, type Vocabulary } from '@shared/schemas/vocabulary'
import { JsonFile } from './jsonFile'

export class VocabularyStore {
  private readonly jf: JsonFile<Vocabulary>

  constructor(file: string) {
    this.jf = new JsonFile(file, VocabularySchema, () => VocabularySchema.parse({}))
  }

  get(): Vocabulary {
    return this.jf.read()
  }

  save(v: Vocabulary): Vocabulary {
    const valid = VocabularySchema.parse(v)
    const out = { ...valid, terms: normalizeTerms(valid.terms) }
    this.jf.write(out)
    return out
  }
}

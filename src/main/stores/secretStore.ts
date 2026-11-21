import { z } from 'zod'
import type { SecretId } from '@shared/providers'
import { JsonFile } from './jsonFile'

/** Implemented with Electron safeStorage in src/main/index.ts. */
export interface Cipher {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(buf: Buffer): string
}

export class SecretsUnavailableError extends Error {
  constructor() {
    super('OS-level encryption is not available; refusing to store secrets')
    this.name = 'SecretsUnavailableError'
  }
}

const FileSchema = z.object({
  version: z.literal(1).default(1),
  entries: z.record(z.string(), z.string()).default({})
})
type SecretsFile = z.infer<typeof FileSchema>

export class SecretStore {
  private readonly jf: JsonFile<SecretsFile>

  constructor(
    file: string,
    private readonly cipher: Cipher
  ) {
    this.jf = new JsonFile(file, FileSchema, () => ({ version: 1, entries: {} }))
  }

  get(id: SecretId): string | null {
    const entries = this.jf.read().entries
    const enc = Object.hasOwn(entries, id) ? entries[id] : undefined
    if (typeof enc !== 'string' || !enc) return null
    if (!this.cipher.isAvailable()) throw new SecretsUnavailableError()
    try {
      return this.cipher.decrypt(Buffer.from(enc, 'base64'))
    } catch {
      return null
    }
  }

  set(id: SecretId, value: string | null): void {
    const file = this.jf.read()
    const entries = { ...file.entries }
    if (value === null || value === '') {
      delete entries[id]
    } else {
      if (!this.cipher.isAvailable()) throw new SecretsUnavailableError()
      entries[id] = this.cipher.encrypt(value).toString('base64')
    }
    this.jf.write({ version: 1, entries })
  }

  has(id: SecretId): boolean {
    const entries = this.jf.read().entries
    return Object.hasOwn(entries, id) && typeof entries[id] === 'string'
  }

  masked(id: SecretId): string | null {
    const v = this.get(id)
    if (v === null) return null
    return v.length < 10 ? `…${v.slice(-2)}` : `${v.slice(0, 3)}…${v.slice(-4)}`
  }
}

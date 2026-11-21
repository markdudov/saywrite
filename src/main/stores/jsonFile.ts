import fs from 'node:fs'
import path from 'node:path'
import type { z } from 'zod'

export class JsonFile<T> {
  constructor(
    private readonly file: string,
    private readonly schema: z.ZodType<T>,
    private readonly defaults: () => T
  ) {}

  /** Missing file → defaults. Invalid JSON/schema → file renamed to `<file>.corrupt-<ts>`, defaults. */
  read(): T {
    let raw: string
    try {
      raw = fs.readFileSync(this.file, 'utf8')
    } catch {
      return this.defaults()
    }
    try {
      const parsed = this.schema.safeParse(JSON.parse(raw))
      if (parsed.success) return parsed.data
    } catch {
      // fall through to backup
    }
    try {
      fs.renameSync(this.file, `${this.file}.corrupt-${Date.now()}`)
    } catch {
      // best effort
    }
    return this.defaults()
  }

  write(value: T): void {
    const valid = this.schema.parse(value)
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(valid, null, 2))
    fs.renameSync(tmp, this.file)
  }
}

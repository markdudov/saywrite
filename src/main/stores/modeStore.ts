import fs from 'node:fs'
import path from 'node:path'
import { BUILTIN_IDS, builtinModes } from '@shared/modes/builtins'
import { ModeSchema, type Mode } from '@shared/schemas/mode'
import { JsonFile } from './jsonFile'

export class BuiltinModeError extends Error {
  constructor(id: string) {
    super(`Built-in mode cannot be deleted: ${id}`)
    this.name = 'BuiltinModeError'
  }
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i

const isBuiltinId = (id: string): boolean => (BUILTIN_IDS as readonly string[]).includes(id)

export class ModeStore {
  private readonly listeners = new Set<(m: Mode[]) => void>()

  constructor(private readonly dir: string) {}

  private fileFor(id: string): string {
    if (!ID_RE.test(id) || RESERVED_NAMES.test(id)) throw new Error('Invalid mode id')
    return path.join(this.dir, `${id}.json`)
  }

  private jf(id: string, fallback: () => Mode): JsonFile<Mode> {
    return new JsonFile(this.fileFor(id), ModeSchema, fallback)
  }

  private notify(): void {
    const all = this.list()
    for (const cb of this.listeners) {
      try {
        cb(all)
      } catch {
        console.warn('Mode change listener threw')
      }
    }
  }

  /** Writes any missing built-in mode files; existing (possibly edited) ones are left alone. */
  ensureBuiltins(): void {
    for (const m of builtinModes()) {
      if (!fs.existsSync(this.fileFor(m.id))) this.jf(m.id, () => m).write(m)
    }
  }

  list(): Mode[] {
    let files: string[]
    try {
      files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.json'))
    } catch {
      return []
    }
    const modes: Mode[] = []
    for (const f of files) {
      try {
        const parsed = ModeSchema.safeParse(
          JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8'))
        )
        if (parsed.success) modes.push(parsed.data)
        else console.warn(`Skipping invalid mode file: ${f}`)
      } catch {
        console.warn(`Skipping invalid mode file: ${f}`)
      }
    }
    return modes.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
  }

  get(id: string): Mode | null {
    const file = this.fileFor(id)
    if (!fs.existsSync(file)) return null
    return this.list().find((m) => m.id === id) ?? null
  }

  save(m: Mode): Mode {
    const valid = ModeSchema.parse(m)
    this.jf(valid.id, () => valid).write(valid)
    this.notify()
    return valid
  }

  delete(id: string): void {
    if (isBuiltinId(id)) throw new BuiltinModeError(id)
    fs.rmSync(this.fileFor(id), { force: true })
    this.notify()
  }

  resetBuiltin(id: string): Mode {
    const original = builtinModes().find((m) => m.id === id)
    if (!original) throw new Error(`Not a built-in mode: ${id}`)
    const current = this.get(id)
    return this.save({
      ...original,
      order: current?.order ?? original.order,
      hotkey: current?.hotkey ?? null
    })
  }

  /** Listed ids come first in the given order; all other modes follow in their current order. */
  reorder(ids: string[]): void {
    const all = this.list()
    ids = [...new Set(ids)]
    const byId = new Map(all.map((m) => [m.id, m]))
    const first = ids.map((id) => byId.get(id)).filter((m): m is Mode => !!m)
    const rest = all.filter((m) => !ids.includes(m.id))
    ;[...first, ...rest].forEach((m, i) => {
      if (m.order !== i) this.jf(m.id, () => m).write({ ...m, order: i })
    })
    this.notify()
  }

  onChange(cb: (m: Mode[]) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
}

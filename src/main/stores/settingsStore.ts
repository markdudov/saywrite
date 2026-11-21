import { deepMerge, type DeepPartial } from '@shared/deepMerge'
import type { Platform } from '@shared/platform'
import { SettingsSchema, defaultSettings, type Settings } from '@shared/schemas/settings'
import { JsonFile } from './jsonFile'

export class SettingsStore {
  private readonly jf: JsonFile<Settings>
  private readonly listeners = new Set<(s: Settings) => void>()

  constructor(file: string, platform: Platform) {
    this.jf = new JsonFile(file, SettingsSchema, () => defaultSettings(platform))
  }

  get(): Settings {
    return this.jf.read()
  }

  /** Merges the patch, validates the result, and writes only if valid (throws otherwise). */
  update(patch: DeepPartial<Settings>): Settings {
    const merged = SettingsSchema.parse(deepMerge(this.get(), patch))
    this.jf.write(merged)
    for (const cb of this.listeners) {
      try {
        cb(merged)
      } catch {
        console.warn('Settings change listener threw')
      }
    }
    return merged
  }

  onChange(cb: (s: Settings) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
}

import fs from 'node:fs/promises'
import path from 'node:path'
import type { RecordingMeta } from '@shared/schemas/recording'

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

const isNotFound = (e: unknown): boolean => (e as NodeJS.ErrnoException)?.code === 'ENOENT'

export class RecordingFiles {
  constructor(private readonly root: string) {}

  private dir(id: string): string {
    if (!ID_RE.test(id)) throw new Error('Invalid recording id')
    return path.join(this.root, 'recordings', id)
  }

  private async readOrNull(file: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(file)
    } catch (e) {
      if (isNotFound(e)) return null
      throw e
    }
  }

  async writeAudio(id: string, wav: Uint8Array): Promise<void> {
    const d = this.dir(id)
    await fs.mkdir(d, { recursive: true })
    await fs.writeFile(path.join(d, 'audio.wav'), wav)
  }

  async readAudio(id: string): Promise<Uint8Array | null> {
    const b = await this.readOrNull(path.join(this.dir(id), 'audio.wav'))
    return b ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : null
  }

  async removeAudio(id: string): Promise<void> {
    await fs.rm(path.join(this.dir(id), 'audio.wav'), { force: true })
  }

  async writeMeta(m: RecordingMeta): Promise<void> {
    const d = this.dir(m.id)
    await fs.mkdir(d, { recursive: true })
    const file = path.join(d, 'meta.json')
    const tmp = `${file}.tmp`
    await fs.writeFile(tmp, JSON.stringify(m, null, 2))
    await fs.rename(tmp, file)
  }

  async readMeta(id: string): Promise<RecordingMeta | null> {
    const b = await this.readOrNull(path.join(this.dir(id), 'meta.json'))
    return b ? (JSON.parse(b.toString('utf8')) as RecordingMeta) : null
  }

  async remove(id: string): Promise<void> {
    await fs.rm(this.dir(id), { recursive: true, force: true })
  }
}

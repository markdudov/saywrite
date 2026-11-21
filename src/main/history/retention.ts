import type { Settings } from '@shared/schemas/settings'
import type { RecordingFiles } from './files'
import type { HistoryRepository } from './repository'

const DAY_MS = 86_400_000
const DAYS = { '90d': 90, '30d': 30, '7d': 7 } as const

export function retentionCutoff(r: Settings['privacy']['retention'], now: number): number | null {
  return r === 'forever' ? null : now - DAYS[r] * DAY_MS
}

export async function purgeExpired(
  repo: HistoryRepository,
  files: RecordingFiles,
  settings: Settings,
  now: number
): Promise<number> {
  const cutoff = retentionCutoff(settings.privacy.retention, now)
  if (cutoff === null) return 0
  const ids = repo.idsOlderThan(cutoff)
  let purged = 0
  for (const id of ids) {
    try {
      // Files first: if removal fails the row stays, so the id is retried on the next purge.
      await files.remove(id)
      repo.delete(id)
      purged++
    } catch {
      console.warn(`History purge failed for recording ${id}`)
    }
  }
  return purged
}

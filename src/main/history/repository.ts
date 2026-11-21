import Database from 'better-sqlite3'
import type { ProviderErrorKind } from '@shared/providers'
import type { RecordingRow, RecordingStatus } from '@shared/schemas/recording'

export type HistoryQuery = {
  text?: string
  modeId?: string
  appId?: string
  status?: RecordingStatus[]
  from?: number
  to?: number
  limit: number
  offset: number
}

type DbRow = {
  id: string
  created_at: number
  status: RecordingStatus
  mode_id: string
  mode_name: string
  app_name: string | null
  app_id: string | null
  duration_ms: number
  raw_text: string | null
  final_text: string | null
  stt_provider: string | null
  stt_model: string | null
  llm_provider: string | null
  llm_model: string | null
  stt_cost_usd: number | null
  llm_cost_usd: number | null
  error_kind: ProviderErrorKind | null
  error_message: string | null
  has_audio: number
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS recordings (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  mode_id TEXT NOT NULL,
  mode_name TEXT NOT NULL,
  app_name TEXT,
  app_id TEXT,
  duration_ms INTEGER NOT NULL,
  raw_text TEXT,
  final_text TEXT,
  stt_provider TEXT,
  stt_model TEXT,
  llm_provider TEXT,
  llm_model TEXT,
  stt_cost_usd REAL,
  llm_cost_usd REAL,
  error_kind TEXT,
  error_message TEXT,
  has_audio INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_recordings_created_at ON recordings(created_at);
CREATE INDEX IF NOT EXISTS idx_recordings_mode_id ON recordings(mode_id);
CREATE VIRTUAL TABLE IF NOT EXISTS recordings_fts USING fts5(
  raw_text, final_text,
  content='recordings', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS recordings_ai AFTER INSERT ON recordings BEGIN
  INSERT INTO recordings_fts(rowid, raw_text, final_text) VALUES (new.rowid, new.raw_text, new.final_text);
END;
CREATE TRIGGER IF NOT EXISTS recordings_ad AFTER DELETE ON recordings BEGIN
  INSERT INTO recordings_fts(recordings_fts, rowid, raw_text, final_text) VALUES ('delete', old.rowid, old.raw_text, old.final_text);
END;
CREATE TRIGGER IF NOT EXISTS recordings_au AFTER UPDATE ON recordings BEGIN
  INSERT INTO recordings_fts(recordings_fts, rowid, raw_text, final_text) VALUES ('delete', old.rowid, old.raw_text, old.final_text);
  INSERT INTO recordings_fts(rowid, raw_text, final_text) VALUES (new.rowid, new.raw_text, new.final_text);
END;
`

export function toFtsQuery(text: string): string | null {
  const tokens = text.match(/[\p{L}\p{N}]+/gu)
  if (!tokens) return null
  return tokens.map((t) => `"${t.toLocaleLowerCase()}"*`).join(' ')
}

const toDb = (r: RecordingRow): DbRow => ({
  id: r.id,
  created_at: r.createdAt,
  status: r.status,
  mode_id: r.modeId,
  mode_name: r.modeName,
  app_name: r.appName,
  app_id: r.appId,
  duration_ms: r.durationMs,
  raw_text: r.rawText,
  final_text: r.finalText,
  stt_provider: r.sttProvider,
  stt_model: r.sttModel,
  llm_provider: r.llmProvider,
  llm_model: r.llmModel,
  stt_cost_usd: r.sttCostUsd,
  llm_cost_usd: r.llmCostUsd,
  error_kind: r.errorKind,
  error_message: r.errorMessage,
  has_audio: r.hasAudio ? 1 : 0
})

const fromDb = (d: DbRow): RecordingRow => ({
  id: d.id,
  createdAt: d.created_at,
  status: d.status,
  modeId: d.mode_id,
  modeName: d.mode_name,
  appName: d.app_name,
  appId: d.app_id,
  durationMs: d.duration_ms,
  rawText: d.raw_text,
  finalText: d.final_text,
  sttProvider: d.stt_provider,
  sttModel: d.stt_model,
  llmProvider: d.llm_provider,
  llmModel: d.llm_model,
  sttCostUsd: d.stt_cost_usd,
  llmCostUsd: d.llm_cost_usd,
  errorKind: d.error_kind,
  errorMessage: d.error_message,
  hasAudio: d.has_audio === 1
})

const COLS = [
  'id',
  'created_at',
  'status',
  'mode_id',
  'mode_name',
  'app_name',
  'app_id',
  'duration_ms',
  'raw_text',
  'final_text',
  'stt_provider',
  'stt_model',
  'llm_provider',
  'llm_model',
  'stt_cost_usd',
  'llm_cost_usd',
  'error_kind',
  'error_message',
  'has_audio'
] as const

export class HistoryRepository {
  private readonly db: Database.Database
  private readonly upsertStmt: Database.Statement
  private readonly getStmt: Database.Statement
  private readonly deleteStmt: Database.Statement
  private readonly recentStmt: Database.Statement
  private readonly olderStmt: Database.Statement

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.exec(SCHEMA)
    this.db.pragma('user_version = 1')

    const updates = COLS.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`)
    this.upsertStmt = this.db.prepare(
      `INSERT INTO recordings (${COLS.join(', ')}) VALUES (${COLS.map((c) => '@' + c).join(', ')})
       ON CONFLICT(id) DO UPDATE SET ${updates.join(', ')}`
    )
    this.getStmt = this.db.prepare('SELECT * FROM recordings WHERE id = ?')
    this.deleteStmt = this.db.prepare('DELETE FROM recordings WHERE id = ?')
    this.recentStmt = this.db.prepare('SELECT * FROM recordings ORDER BY created_at DESC LIMIT ?')
    this.olderStmt = this.db.prepare('SELECT id FROM recordings WHERE created_at < ?')
  }

  upsert(row: RecordingRow): void {
    this.upsertStmt.run(toDb(row))
  }

  get(id: string): RecordingRow | null {
    const r = this.getStmt.get(id) as DbRow | undefined
    return r ? fromDb(r) : null
  }

  search(q: HistoryQuery): { rows: RecordingRow[]; total: number } {
    const where: string[] = []
    const params: unknown[] = []
    const fts = q.text ? toFtsQuery(q.text) : null
    if (fts) {
      where.push(
        'recordings.rowid IN (SELECT rowid FROM recordings_fts WHERE recordings_fts MATCH ?)'
      )
      params.push(fts)
    }
    if (q.modeId !== undefined) {
      where.push('mode_id = ?')
      params.push(q.modeId)
    }
    if (q.appId !== undefined) {
      where.push('app_id = ?')
      params.push(q.appId)
    }
    if (q.status && q.status.length > 0) {
      where.push(`status IN (${q.status.map(() => '?').join(', ')})`)
      params.push(...q.status)
    }
    if (q.from !== undefined) {
      where.push('created_at >= ?')
      params.push(q.from)
    }
    if (q.to !== undefined) {
      where.push('created_at <= ?')
      params.push(q.to)
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM recordings ${clause}`).get(...params) as {
        n: number
      }
    ).n
    const rows = this.db
      .prepare(
        `SELECT * FROM recordings ${clause} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`
      )
      .all(...params, q.limit, q.offset) as DbRow[]
    return { rows: rows.map(fromDb), total }
  }

  delete(id: string): void {
    this.deleteStmt.run(id)
  }

  recent(n: number): RecordingRow[] {
    return (this.recentStmt.all(n) as DbRow[]).map(fromDb)
  }

  monthlyCost(yearMonth: string): { provider: string; costUsd: number }[] {
    const m = /^(\d{4})-(\d{2})$/.exec(yearMonth)
    if (!m) throw new Error('Invalid yearMonth')
    const y = Number(m[1])
    const mo = Number(m[2])
    const start = new Date(y, mo - 1, 1).getTime()
    const end = new Date(y, mo, 1).getTime()
    const sum = (provCol: string, costCol: string): { provider: string; total: number }[] =>
      this.db
        .prepare(
          `SELECT ${provCol} AS provider, SUM(${costCol}) AS total FROM recordings
           WHERE created_at >= ? AND created_at < ? AND ${provCol} IS NOT NULL AND ${costCol} IS NOT NULL
           GROUP BY ${provCol}`
        )
        .all(start, end) as { provider: string; total: number }[]
    const merged = new Map<string, number>()
    for (const { provider, total } of [
      ...sum('stt_provider', 'stt_cost_usd'),
      ...sum('llm_provider', 'llm_cost_usd')
    ]) {
      merged.set(provider, (merged.get(provider) ?? 0) + total)
    }
    return [...merged].map(([provider, t]) => ({ provider, costUsd: Number(t.toFixed(6)) }))
  }

  idsOlderThan(ts: number): string[] {
    return (this.olderStmt.all(ts) as { id: string }[]).map((r) => r.id)
  }

  close(): void {
    this.db.close()
  }
}

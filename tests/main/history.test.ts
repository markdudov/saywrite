import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { HistoryRepository, toFtsQuery, type HistoryQuery } from '../../src/main/history/repository'
import { RecordingFiles } from '../../src/main/history/files'
import { purgeExpired, retentionCutoff } from '../../src/main/history/retention'
import { defaultSettings } from '@shared/schemas/settings'
import type { RecordingMeta, RecordingRow } from '@shared/schemas/recording'

let dir: string
let repo: HistoryRepository
let n = 0

const row = (o: Partial<RecordingRow> = {}): RecordingRow => ({
  id: `r${++n}`,
  createdAt: 1_000,
  status: 'done',
  modeId: 'dictate',
  modeName: 'Dictate',
  appName: null,
  appId: null,
  durationMs: 1000,
  rawText: null,
  finalText: null,
  sttProvider: null,
  sttModel: null,
  llmProvider: null,
  llmModel: null,
  sttCostUsd: null,
  llmCostUsd: null,
  errorKind: null,
  errorMessage: null,
  hasAudio: false,
  ...o
})

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saywrite-history-'))
  repo = new HistoryRepository(path.join(dir, 'history.db'))
})
afterEach(() => {
  repo.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

const q = (o: object = {}): HistoryQuery => ({ limit: 10, offset: 0, ...o })

test('upsert/get round-trip', () => {
  const r = row({
    id: 'x',
    rawText: 'raw',
    finalText: 'final',
    hasAudio: true,
    errorKind: 'auth',
    errorMessage: 'm',
    sttCostUsd: 0.5,
    appName: 'Code',
    appId: 'com.x'
  })
  repo.upsert(r)
  expect(repo.get('x')).toEqual(r)
  expect(repo.get('nope')).toBeNull()
  repo.upsert({ ...r, finalText: 'changed', hasAudio: false })
  expect(repo.get('x')?.finalText).toBe('changed')
  expect(repo.get('x')?.hasAudio).toBe(false)
})

test('Cyrillic prefix + case-insensitive search', () => {
  repo.upsert(row({ id: 'a', finalText: 'Комитът е готов' }))
  repo.upsert(row({ id: 'b', finalText: 'nothing here' }))
  expect(repo.search(q({ text: 'коми' })).rows.map((r) => r.id)).toEqual(['a'])
  expect(repo.search(q({ text: 'КОМИТЪТ' })).total).toBe(1)
})

test('search tolerates FTS syntax characters and finds updated text', () => {
  repo.upsert(row({ id: 'a', rawText: 'hello world' }))
  expect(() => repo.search(q({ text: '"hello* OR (NEAR' }))).not.toThrow()
  expect(repo.search(q({ text: '"hello*' })).rows.map((r) => r.id)).toEqual(['a'])
  repo.upsert(row({ id: 'a', rawText: 'goodbye' }))
  expect(repo.search(q({ text: 'hello' })).total).toBe(0)
  expect(repo.search(q({ text: 'good' })).total).toBe(1)
  expect(repo.search(q({ text: ' ,, ' })).total).toBe(1)
})

test('filters and pagination', () => {
  repo.upsert(row({ id: 'a', createdAt: 1, modeId: 'm1', status: 'done', appId: 'app1' }))
  repo.upsert(row({ id: 'b', createdAt: 2, modeId: 'm2', status: 'failed' }))
  repo.upsert(row({ id: 'c', createdAt: 3, modeId: 'm1', status: 'failed' }))
  repo.upsert(row({ id: 'd', createdAt: 4, modeId: 'm1', status: 'done' }))
  expect(repo.search(q()).rows.map((r) => r.id)).toEqual(['d', 'c', 'b', 'a'])
  expect(repo.search(q({ modeId: 'm1' })).rows.map((r) => r.id)).toEqual(['d', 'c', 'a'])
  expect(repo.search(q({ modeId: 'm1', status: ['failed'] })).rows.map((r) => r.id)).toEqual(['c'])
  expect(repo.search(q({ status: ['failed', 'done'] })).total).toBe(4)
  expect(repo.search(q({ appId: 'app1' })).rows.map((r) => r.id)).toEqual(['a'])
  expect(repo.search(q({ from: 2, to: 3 })).rows.map((r) => r.id)).toEqual(['c', 'b'])
  const page = repo.search({ limit: 2, offset: 1 })
  expect(page.rows.map((r) => r.id)).toEqual(['c', 'b'])
  expect(page.total).toBe(4)
  expect(repo.recent(2).map((r) => r.id)).toEqual(['d', 'c'])
})

test('delete removes from FTS', () => {
  repo.upsert(row({ id: 'a', finalText: 'unique zebra' }))
  expect(repo.search(q({ text: 'zebra' })).total).toBe(1)
  repo.delete('a')
  expect(repo.get('a')).toBeNull()
  expect(repo.search(q({ text: 'zebra' })).total).toBe(0)
})

test('monthlyCost groups by provider', () => {
  repo.upsert(
    row({
      createdAt: Date.parse('2026-11-03T10:00'),
      sttProvider: 'groq',
      sttCostUsd: 0.01,
      llmProvider: 'anthropic',
      llmCostUsd: 0.02
    })
  )
  repo.upsert(
    row({
      createdAt: Date.parse('2026-11-04T10:00'),
      sttProvider: 'groq',
      sttCostUsd: 0.03,
      llmProvider: null,
      llmCostUsd: null
    })
  )
  repo.upsert(
    row({
      createdAt: Date.parse('2026-10-31T23:59'),
      sttProvider: 'groq',
      sttCostUsd: 9,
      llmProvider: null,
      llmCostUsd: null
    })
  )
  repo.upsert(
    row({
      createdAt: Date.parse('2026-12-01T00:00'),
      sttProvider: 'groq',
      sttCostUsd: 9,
      llmProvider: null,
      llmCostUsd: null
    })
  )
  const cost = repo.monthlyCost('2026-11')
  expect(cost).toHaveLength(2)
  expect(cost).toEqual(
    expect.arrayContaining([
      { provider: 'groq', costUsd: 0.04 },
      { provider: 'anthropic', costUsd: 0.02 }
    ])
  )
})

test('idsOlderThan', () => {
  repo.upsert(row({ id: 'old', createdAt: 10 }))
  repo.upsert(row({ id: 'new', createdAt: 100 }))
  expect(repo.idsOlderThan(50)).toEqual(['old'])
})

test('toFtsQuery', () => {
  expect(toFtsQuery('Hello, свят!')).toBe('"hello"* "свят"*')
  expect(toFtsQuery('  ,, ')).toBeNull()
})

test('RecordingFiles round-trip and removal', async () => {
  const files = new RecordingFiles(path.join(dir, 'recordings-root'))
  expect(await files.readAudio('a1')).toBeNull()
  expect(await files.readMeta('a1')).toBeNull()
  await files.writeAudio('a1', new Uint8Array([1, 2, 3]))
  expect(Array.from((await files.readAudio('a1'))!)).toEqual([1, 2, 3])
  const meta = { ...row({ id: 'a1' }), schemaVersion: 1 } as unknown as RecordingMeta
  await files.writeMeta(meta)
  expect(await files.readMeta('a1')).toEqual(meta)
  expect(fs.readdirSync(path.join(dir, 'recordings-root', 'recordings', 'a1')).sort()).toEqual([
    'audio.wav',
    'meta.json'
  ])
  await files.removeAudio('a1')
  expect(await files.readAudio('a1')).toBeNull()
  await files.removeAudio('a1')
  await files.remove('a1')
  expect(fs.existsSync(path.join(dir, 'recordings-root', 'recordings', 'a1'))).toBe(false)
  await expect(files.writeAudio('../evil', new Uint8Array())).rejects.toThrow()
  await expect(files.readMeta('a/b')).rejects.toThrow()
})

test('retentionCutoff', () => {
  expect(retentionCutoff('forever', 1e12)).toBeNull()
  expect(retentionCutoff('7d', 1e12)).toBe(1e12 - 7 * 86_400_000)
  expect(retentionCutoff('30d', 1e12)).toBe(1e12 - 30 * 86_400_000)
  expect(retentionCutoff('90d', 1e12)).toBe(1e12 - 90 * 86_400_000)
})

test('purgeExpired removes rows and folders older than 30d', async () => {
  const files = new RecordingFiles(path.join(dir, 'root'))
  const now = Date.parse('2026-11-21T12:00')
  const day = 86_400_000
  repo.upsert(row({ id: 'old', createdAt: now - 31 * day }))
  repo.upsert(row({ id: 'fresh', createdAt: now - 29 * day }))
  await files.writeAudio('old', new Uint8Array([1]))
  await files.writeAudio('fresh', new Uint8Array([1]))
  const settings = defaultSettings('darwin')
  settings.privacy.retention = '30d'
  expect(await purgeExpired(repo, files, settings, now)).toBe(1)
  expect(repo.get('old')).toBeNull()
  expect(repo.get('fresh')).not.toBeNull()
  expect(await files.readAudio('old')).toBeNull()
  expect(await files.readAudio('fresh')).not.toBeNull()
  settings.privacy.retention = 'forever'
  expect(await purgeExpired(repo, files, settings, now + 1000 * day)).toBe(0)
})

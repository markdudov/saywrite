import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { JsonFile } from '../../src/main/stores/jsonFile'
import { SettingsStore } from '../../src/main/stores/settingsStore'
import { BuiltinModeError, ModeStore } from '../../src/main/stores/modeStore'
import { VocabularyStore } from '../../src/main/stores/vocabularyStore'
import {
  SecretStore,
  SecretsUnavailableError,
  type Cipher
} from '../../src/main/stores/secretStore'
import { appPaths } from '../../src/main/paths'
import { ModeSchema } from '../../src/shared/schemas/mode'

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saywrite-stores-'))
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

function fakeCipher(): Cipher & { available: boolean } {
  const xor = (b: Buffer): Buffer => Buffer.from(b.map((x) => x ^ 0x5a))
  const c = {
    available: true,
    isAvailable: () => c.available,
    encrypt: (p: string) => xor(Buffer.from(p, 'utf8')),
    decrypt: (b: Buffer) => xor(b).toString('utf8')
  }
  return c
}

test('appPaths derives all locations from root', () => {
  const p = appPaths('/r')
  expect(p.settings).toBe(path.join('/r', 'settings.json'))
  expect(p.modesDir).toBe(path.join('/r', 'modes'))
  expect(p.recordingsDir).toBe(path.join('/r', 'recordings'))
})

test('JsonFile atomic write + read', () => {
  const file = path.join(dir, 'sub', 'a.json')
  const jf = new JsonFile(file, z.object({ n: z.number() }), () => ({ n: 0 }))
  jf.write({ n: 5 })
  expect(jf.read()).toEqual({ n: 5 })
  expect(fs.existsSync(file + '.tmp')).toBe(false)
})

test('JsonFile corrupt → backup + defaults', () => {
  const file = path.join(dir, 'a.json')
  fs.writeFileSync(file, 'nope')
  const jf = new JsonFile(file, z.object({ n: z.number() }), () => ({ n: 0 }))
  expect(jf.read()).toEqual({ n: 0 })
  expect(fs.readdirSync(dir).some((f) => f.includes('.corrupt-'))).toBe(true)
})

test('SettingsStore.update merges and validates', () => {
  const file = path.join(dir, 'settings.json')
  const s = new SettingsStore(file, 'darwin')
  const seen: boolean[] = []
  s.onChange((x) => seen.push(x.sounds))
  s.update({ sounds: false })
  expect(s.get().sounds).toBe(false)
  expect(seen).toEqual([false])
  expect(() => s.update({ hotkeys: { holdThresholdMs: 5 } })).toThrow()
  expect(seen).toHaveLength(1)
  expect(new SettingsStore(file, 'darwin').get().hotkeys.holdThresholdMs).toBe(300)
})

const custom = ModeSchema.parse({ id: 'custom-1', name: 'Custom', order: 10 })

test('ModeStore built-ins and CRUD', () => {
  const store = new ModeStore(path.join(dir, 'modes'))
  store.ensureBuiltins()
  expect(store.list()).toHaveLength(7)
  store.save({ ...custom, order: -1 })
  expect(store.list()[0].id).toBe(custom.id)
  expect(() => store.delete('builtin-clean')).toThrow(BuiltinModeError)
  store.save({ ...store.get('builtin-clean')!, name: 'Mine' })
  expect(store.resetBuiltin('builtin-clean').name).toBe('Clean')
  store.reorder(['builtin-edit', 'builtin-dictation'])
  expect(store.list()[0].id).toBe('builtin-edit')
  expect(store.list()[1].id).toBe('builtin-dictation')
  store.delete(custom.id)
  expect(store.get(custom.id)).toBeNull()
})

test('ModeStore rejects path-escaping ids, skips invalid files, notifies', () => {
  const modes = path.join(dir, 'modes')
  const store = new ModeStore(modes)
  store.ensureBuiltins()
  expect(() => store.save({ ...custom, id: '../evil' })).toThrow()
  expect(() => store.save({ ...custom, id: 'a/b' })).toThrow()
  expect(() => store.get('..\\x')).toThrow()
  fs.writeFileSync(path.join(modes, 'bad.json'), '{"id":1}')
  expect(store.list()).toHaveLength(7)
  let n = 0
  store.onChange(() => n++)
  store.save(custom)
  expect(n).toBe(1)
})

test('VocabularyStore normalizes', () => {
  const v = new VocabularyStore(path.join(dir, 'vocab.json'))
  expect(v.get().terms).toEqual([])
  const saved = v.save({ schemaVersion: 1, terms: [' A ', 'a'], replacements: [] })
  expect(saved.terms).toEqual(['A'])
  expect(v.get().terms).toEqual(['A'])
})

test('SecretStore encrypts, masks, removes', () => {
  const file = path.join(dir, 'secrets.json')
  const secrets = new SecretStore(file, fakeCipher())
  secrets.set('openai', 'sk-abcdef123456')
  expect(fs.readFileSync(file, 'utf8')).not.toContain('abcdef')
  expect(secrets.get('openai')).toBe('sk-abcdef123456')
  expect(secrets.masked('openai')).toBe('sk-…3456')
  secrets.set('groq', 'short')
  expect(secrets.masked('groq')).toBe('…rt')
  secrets.set('openai', null)
  expect(secrets.has('openai')).toBe(false)
  expect(secrets.get('openai')).toBeNull()
})

test('SecretStore refuses without OS encryption', () => {
  const cipher = fakeCipher()
  const secrets = new SecretStore(path.join(dir, 'secrets.json'), cipher)
  cipher.available = false
  expect(() => secrets.set('openai', 'x')).toThrow(SecretsUnavailableError)
})

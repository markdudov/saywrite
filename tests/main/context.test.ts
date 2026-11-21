import { expect, test } from 'vitest'
import { parseLsappinfo } from '../../src/main/context/activeApp.mac'
import { exeBasename } from '../../src/main/context/activeApp.win'
import { getActiveApp, isForegroundElevated } from '../../src/main/context/activeApp'
import { allowsImplicitSelection, isTerminal } from '../../src/main/context/terminals'
import { environmentInfo } from '../../src/main/context/environment'
import {
  captureSelection,
  type ClipboardPort,
  type ClipboardSnapshot,
  type KeySender
} from '../../src/main/context/selection'
import { defaultSettings } from '@shared/schemas/settings'

const REAL_OUTPUT = `"Claude" ASN:0x0-0x53053: (in front) 
    bundleID="com.anthropic.claudefordesktop"
    bundle path=[ NULL ] 
    executable path=[ NULL ] 
 !cgsConnection !signalled type=[ NULL ]  flavor=[ NULL ]  Version=[ NULL ]  Arch=!!none 
`

test('parseLsappinfo', () => {
  expect(parseLsappinfo(REAL_OUTPUT)).toEqual({
    name: 'Claude',
    id: 'com.anthropic.claudefordesktop'
  })
  expect(
    parseLsappinfo(
      '"Claude" ASN:0x0-0x53053: (in front) \n    bundleID="com.anthropic.claudefordesktop"\n'
    )
  ).toEqual({ name: 'Claude', id: 'com.anthropic.claudefordesktop' })
  expect(parseLsappinfo('"Thing" ASN:0x1-0x2:\n')).toEqual({ name: 'Thing', id: '' })
  expect(parseLsappinfo('')).toBeNull()
})

test('exeBasename handles Windows and posix paths', () => {
  expect(exeBasename('C:\\Program Files\\Microsoft VS Code\\Code.exe')).toEqual({
    name: 'Code',
    id: 'Code.exe'
  })
  expect(exeBasename('C:\\x\\Tool.EXE')).toEqual({ name: 'Tool', id: 'Tool.EXE' })
  expect(exeBasename('plain.exe')).toEqual({ name: 'plain', id: 'plain.exe' })
})

test('isTerminal / allowsImplicitSelection', () => {
  expect(isTerminal({ name: 'T', id: 'com.apple.Terminal' }, 'darwin')).toBe(true)
  expect(isTerminal({ name: 'WT', id: 'windowsterminal.EXE' }, 'win32')).toBe(true)
  expect(isTerminal({ name: 'Code', id: 'com.microsoft.VSCode' }, 'darwin')).toBe(false)
  expect(allowsImplicitSelection({ name: 'Code', id: 'com.microsoft.VSCode' }, 'darwin')).toBe(
    false
  )
  expect(allowsImplicitSelection({ name: 'Cursor', id: 'cursor.exe' }, 'win32')).toBe(false)
  expect(allowsImplicitSelection({ name: 'T', id: 'com.apple.Terminal' }, 'darwin')).toBe(false)
  expect(allowsImplicitSelection({ name: 'Notes', id: 'com.apple.Notes' }, 'darwin')).toBe(true)
  // mac ids are case-sensitive; ids from the other platform never match
  expect(isTerminal({ name: 'T', id: 'COM.APPLE.TERMINAL' }, 'darwin')).toBe(false)
  expect(isTerminal({ name: 'T', id: 'com.apple.Terminal' }, 'win32')).toBe(false)
  expect(isTerminal(null, 'darwin')).toBe(false)
  expect(allowsImplicitSelection(null, 'darwin')).toBe(true)
})

test('getActiveApp on a non-matching platform and elevation on darwin', async () => {
  expect(isForegroundElevated()).toBe(false)
  if (process.platform === 'darwin') {
    const app = await getActiveApp('darwin')
    expect(app === null || typeof app.id === 'string').toBe(true)
  }
})

function noop(): void {
  /* intentionally empty */
}

const enc = (t: string): Uint8Array => new TextEncoder().encode(t)
const snap = (t: string, extra: Record<string, Uint8Array> = {}): ClipboardSnapshot => ({
  items: [{ 'text/plain': enc(t), ...extra }]
})

function fakeClipboard(
  initial: ClipboardSnapshot
): ClipboardPort & { restored?: ClipboardSnapshot; current(): string } {
  let text = new TextDecoder().decode(initial.items[0]?.['text/plain'] ?? new Uint8Array())
  const cb = {
    restored: undefined as ClipboardSnapshot | undefined,
    snapshot: async () => structuredClone(initial),
    async restore(s: ClipboardSnapshot) {
      cb.restored = s
    },
    readText: async () => text,
    current: () => text,
    async writeText(t: string) {
      text = t
    }
  }
  return cb
}

function fakeKeys(onCopy: () => void = noop): KeySender {
  return {
    paste: noop,
    copy: onCopy,
    enter: noop,
    modifiersDown: () => false
  }
}

function fakeSleep(): { calls: number[]; sleep(ms: number): Promise<void> } {
  const calls: number[] = []
  return {
    calls,
    sleep: async (ms: number) => {
      calls.push(ms)
    }
  }
}

test('captureSelection returns copied text and restores clipboard', async () => {
  const cb = fakeClipboard(
    snap('orig', { 'text/html': enc('<b>orig</b>'), 'image/png': Uint8Array.from([1, 2, 3]) })
  )
  const keys = fakeKeys(() => void cb.writeText('selected words'))
  const { sleep } = fakeSleep()
  expect(await captureSelection({ clipboard: cb, keys, sleep, random: () => 'r1' })).toBe(
    'selected words'
  )
  expect(cb.restored).toEqual(
    snap('orig', { 'text/html': enc('<b>orig</b>'), 'image/png': Uint8Array.from([1, 2, 3]) })
  )
})

test('captureSelection writes the sentinel before copying', async () => {
  const cb = fakeClipboard(snap('orig'))
  let seen = ''
  const keys = fakeKeys(() => {
    seen = cb.current()
    void cb.writeText('x')
  })
  await captureSelection({ clipboard: cb, keys, sleep: async () => {}, random: () => 'r1' })
  expect(seen).toBe('saywrite-sentinel-r1')
})

test('captureSelection: nothing selected → null after timeout, clipboard restored', async () => {
  const cb = fakeClipboard(snap('orig'))
  const { sleep, calls } = fakeSleep()
  const result = await captureSelection(
    { clipboard: cb, keys: fakeKeys(), sleep, random: () => 'r2' },
    { timeoutMs: 300, pollMs: 15 }
  )
  expect(result).toBeNull()
  expect(calls.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(300)
  expect(calls.every((c) => c === 15)).toBe(true)
  expect(cb.restored).toEqual(snap('orig'))
})

test('captureSelection: whitespace-only → null', async () => {
  const cb = fakeClipboard(snap('orig'))
  const keys = fakeKeys(() => void cb.writeText('  \n '))
  expect(
    await captureSelection({ clipboard: cb, keys, sleep: async () => {}, random: () => 'r' })
  ).toBeNull()
})

test('captureSelection restores the clipboard even when copy throws', async () => {
  const cb = fakeClipboard(snap('orig'))
  const keys = fakeKeys(() => {
    throw new Error('boom')
  })
  await expect(
    captureSelection({ clipboard: cb, keys, sleep: async () => {}, random: () => 'r' })
  ).rejects.toThrow('boom')
  expect(cb.restored).toEqual(snap('orig'))
})

test('environmentInfo', () => {
  const settings = { ...defaultSettings('darwin'), userName: 'Mark' }
  const now = new Date('2026-11-21T10:20:30.000Z')
  const env = environmentInfo(settings, now)
  expect(env.userName).toBe('Mark')
  expect(env.nowIso).toBe('2026-11-21T10:20:30.000Z')
  expect(env.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  expect(env.osLocale).toBe(Intl.DateTimeFormat().resolvedOptions().locale)
})

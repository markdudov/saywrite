import { describe, expect, test } from 'vitest'
import { deliverText } from '../../src/main/output/deliver'
import type { ClipboardPort, ClipboardSnapshot, KeySender } from '../../src/main/context/selection'

type Setup = {
  log: string[]
  deps: Parameters<typeof deliverText>[2]
  setCurrent(s: ClipboardSnapshot): void
  readonly restored: ClipboardSnapshot | undefined
  readonly snapshotObj: ClipboardSnapshot | undefined
}

function setup(
  init: {
    modifiers?: boolean[] | 'always'
    elevated?: boolean
    readText?: string
    pasteThrows?: boolean
  } = {}
): Setup {
  const log: string[] = []
  let current: ClipboardSnapshot = { text: 'orig' }
  let restored: ClipboardSnapshot | undefined
  let snapshotObj: ClipboardSnapshot | undefined
  const mods = Array.isArray(init.modifiers) ? [...init.modifiers] : []
  const clipboard: ClipboardPort = {
    snapshot: () => {
      log.push('snapshot')
      snapshotObj = structuredClone(current)
      return snapshotObj
    },
    restore: (s) => {
      log.push('restore')
      restored = s
      current = s
    },
    readText: () => {
      log.push('read')
      return init.readText ?? current.text ?? ''
    },
    writeText: (t) => {
      log.push(`write:${t}`)
      current = { text: t }
    }
  }
  const keys: KeySender = {
    paste: () => {
      log.push('paste')
      if (init.pasteThrows) throw new Error('boom')
    },
    copy: () => log.push('copy'),
    enter: () => {
      log.push('enter')
    },
    modifiersDown: () => (init.modifiers === 'always' ? true : (mods.shift() ?? false))
  }
  const deps = {
    clipboard,
    keys,
    sleep: async (ms: number) => {
      log.push(`sleep:${ms}`)
    },
    isForegroundElevated: () => init.elevated ?? false
  }
  return {
    log,
    deps,
    setCurrent: (s: ClipboardSnapshot) => (current = s),
    get restored() {
      return restored
    },
    get snapshotObj() {
      return snapshotObj
    }
  }
}

const opts = {
  action: 'paste' as const,
  pressEnter: false,
  restoreClipboard: true,
  pasteDelayMs: 80,
  restoreDelayMs: 400
}

describe('deliverText', () => {
  test('paste order and restore', async () => {
    const s = setup()
    expect(await deliverText('hi', opts, s.deps)).toEqual({ delivered: 'pasted' })
    expect(s.log).toEqual([
      'snapshot',
      'write:hi',
      'sleep:80',
      'paste',
      'sleep:400',
      'read',
      'restore'
    ])
  })

  test('restores rich clipboard exactly', async () => {
    const snap = {
      text: 't',
      html: '<i>t</i>',
      rtf: '{\\rtf1 t}',
      imagePng: Uint8Array.from([1, 2, 3])
    }
    const s = setup()
    s.setCurrent(snap)
    await deliverText('hi', opts, s.deps)
    expect(s.restored).toEqual(snap)
    expect(s.restored).toBe(s.snapshotObj)
    expect(Array.from(s.restored!.imagePng!)).toEqual([1, 2, 3])
  })

  test('no restore when user copied meanwhile', async () => {
    const s = setup({ readText: 'other' })
    await deliverText('hi', opts, s.deps)
    expect(s.log).toContain('read')
    expect(s.log).not.toContain('restore')
  })

  test('pressEnter', async () => {
    const s = setup()
    await deliverText('hi', { ...opts, pressEnter: true }, s.deps)
    expect(s.log).toEqual([
      'snapshot',
      'write:hi',
      'sleep:80',
      'paste',
      'sleep:60',
      'enter',
      'sleep:400',
      'read',
      'restore'
    ])
  })

  test('copy action', async () => {
    const s = setup()
    expect(await deliverText('x', { ...opts, action: 'copy' }, s.deps)).toEqual({
      delivered: 'copied',
      reason: 'copy_action'
    })
    expect(s.log).toEqual(['write:x'])
  })

  test('replaceSelection pastes like paste', async () => {
    const s = setup()
    expect(await deliverText('x', { ...opts, action: 'replaceSelection' }, s.deps)).toEqual({
      delivered: 'pasted'
    })
    expect(s.log).toContain('paste')
  })

  test('restoreClipboard false', async () => {
    const s = setup()
    await deliverText('hi', { ...opts, restoreClipboard: false }, s.deps)
    expect(s.log).toEqual(['write:hi', 'sleep:80', 'paste'])
  })

  test('waits for modifier release', async () => {
    const s = setup({ modifiers: [true, true, true, false] })
    expect(await deliverText('hi', opts, s.deps)).toEqual({ delivered: 'pasted' })
    expect(s.log.slice(0, 3)).toEqual(['sleep:20', 'sleep:20', 'sleep:20'])
    expect(s.log).toContain('paste')
  })

  test('modifiers still held → copy', async () => {
    const s = setup({ modifiers: 'always' })
    expect(await deliverText('hi', opts, s.deps)).toEqual({
      delivered: 'copied',
      reason: 'modifiers_held'
    })
    expect(s.log).not.toContain('paste')
    expect(s.log).not.toContain('snapshot')
    expect(s.log.filter((l) => l === 'sleep:20')).toHaveLength(50)
    expect(s.log).toContain('write:hi')
  })

  test('elevated foreground → copy', async () => {
    const s = setup({ elevated: true })
    expect(await deliverText('hi', opts, s.deps)).toEqual({
      delivered: 'copied',
      reason: 'elevated'
    })
    expect(s.log).toEqual(['write:hi'])
  })

  test('paste failure restores clipboard and rethrows', async () => {
    const s = setup({ pasteThrows: true })
    await expect(deliverText('hi', opts, s.deps)).rejects.toThrow('boom')
    expect(s.log).toEqual(['snapshot', 'write:hi', 'sleep:80', 'paste', 'read', 'restore'])
  })
})

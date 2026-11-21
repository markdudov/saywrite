import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => {
  const listeners = new Map<string, (e: { keycode: number }) => void>()
  return {
    listeners,
    startThrows: false,
    start: vi.fn(),
    stop: vi.fn(),
    keyTap: vi.fn()
  }
})

vi.mock('uiohook-napi', () => ({
  UiohookKey: { V: 47, C: 46, Enter: 28, Meta: 3675, Ctrl: 29 },
  uIOhook: {
    on: (ev: string, fn: (e: { keycode: number }) => void) => h.listeners.set(ev, fn),
    off: (ev: string) => h.listeners.delete(ev),
    start: () => {
      h.start()
      if (h.startThrows) throw new Error('no permission')
    },
    stop: () => h.stop(),
    keyTap: (...a: unknown[]) => h.keyTap(...a)
  }
}))

import { createKeyHook, createKeySender, type KeyHook } from '../../src/main/native/keyboard'
import { KEY } from '../../src/shared/keys'

const fire = (ev: 'keydown' | 'keyup', keycode: number): void => h.listeners.get(ev)?.({ keycode })

beforeEach(() => {
  h.listeners.clear()
  h.startThrows = false
  h.start.mockClear()
  h.stop.mockClear()
  h.keyTap.mockClear()
})

describe('createKeyHook', () => {
  test('tracks pressed keys and forwards events', () => {
    const down: number[] = []
    const up: number[] = []
    const hook = createKeyHook(
      (c) => down.push(c),
      (c) => up.push(c)
    )
    expect(hook.start()).toBe(true)
    fire('keydown', KEY.Shift)
    fire('keydown', KEY.V)
    expect([...hook.pressed()].sort()).toEqual([KEY.V, KEY.Shift].sort())
    fire('keyup', KEY.V)
    expect([...hook.pressed()]).toEqual([KEY.Shift])
    expect(down).toEqual([KEY.Shift, KEY.V])
    expect(up).toEqual([KEY.V])
  })

  test('start and stop are idempotent; stop clears pressed and removes listeners', () => {
    const hook = createKeyHook(
      () => {},
      () => {}
    )
    hook.start()
    hook.start()
    expect(h.start).toHaveBeenCalledTimes(1)
    fire('keydown', KEY.Ctrl)
    hook.stop()
    hook.stop()
    expect(h.stop).toHaveBeenCalledTimes(1)
    expect(hook.pressed().size).toBe(0)
    expect(h.listeners.size).toBe(0)
  })

  test('start returns false and removes listeners when uIOhook.start throws', () => {
    h.startThrows = true
    const hook = createKeyHook(
      () => {},
      () => {}
    )
    expect(hook.start()).toBe(false)
    expect(h.listeners.size).toBe(0)
  })

  test('a throwing consumer does not propagate', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const hook = createKeyHook(
      () => {
        throw new Error('x')
      },
      () => {
        throw new Error('y')
      }
    )
    hook.start()
    expect(() => fire('keydown', KEY.V)).not.toThrow()
    expect(() => fire('keyup', KEY.V)).not.toThrow()
    expect(hook.pressed().size).toBe(0)
    warn.mockRestore()
  })
})

describe('createKeySender', () => {
  const hookWith = (keys: number[]): KeyHook => ({
    start: () => true,
    stop: () => {},
    pressed: () => new Set(keys)
  })

  test('modifiersDown is true only when a modifier is pressed', () => {
    expect(createKeySender('darwin', hookWith([])).modifiersDown()).toBe(false)
    expect(createKeySender('darwin', hookWith([KEY.V])).modifiersDown()).toBe(false)
    expect(createKeySender('darwin', hookWith([KEY.V, KEY.AltRight])).modifiersDown()).toBe(true)
  })

  test('paste/copy use Meta on mac and Ctrl on windows, enter has no modifier', () => {
    const mac = createKeySender('darwin', hookWith([]))
    mac.paste()
    mac.copy()
    mac.enter()
    expect(h.keyTap.mock.calls).toEqual([[47, [3675]], [46, [3675]], [28]])
    h.keyTap.mockClear()
    createKeySender('win32', hookWith([])).paste()
    expect(h.keyTap.mock.calls).toEqual([[47, [29]]])
  })
})

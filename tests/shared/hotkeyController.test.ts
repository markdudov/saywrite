import { beforeEach, describe, expect, test } from 'vitest'
import { KEY } from '../../src/shared/keys'
import { HotkeyController, type HotkeyBinding } from '../../src/shared/hotkeys/controller'

const bindings: HotkeyBinding[] = [
  { keys: [KEY.AltRight], action: { kind: 'dictate', modeId: null } },
  { keys: [KEY.Shift, KEY.AltRight], action: { kind: 'edit' } },
  { keys: [KEY.Ctrl, KEY.Digit1], action: { kind: 'dictate', modeId: 'm1' } }
]

let c: HotkeyController
beforeEach(() => {
  c = new HotkeyController({ bindings, holdThresholdMs: 300 })
})

describe('HotkeyController', () => {
  test('tap toggles', () => {
    expect(c.keyDown(KEY.AltRight, 0)).toEqual({
      type: 'start',
      action: { kind: 'dictate', modeId: null }
    })
    expect(c.keyUp(KEY.AltRight, 120)).toBeNull()
    expect(c.keyDown(KEY.AltRight, 2000)).toEqual({ type: 'stop' })
    expect(c.keyUp(KEY.AltRight, 2100)).toBeNull()
  })

  test('hold to talk', () => {
    c.keyDown(KEY.AltRight, 0)
    expect(c.keyUp(KEY.AltRight, 900)).toEqual({ type: 'stop' })
  })

  test('threshold boundary', () => {
    c.keyDown(KEY.AltRight, 0)
    expect(c.keyUp(KEY.AltRight, 299)).toBeNull()
    const fresh = new HotkeyController({ bindings, holdThresholdMs: 300 })
    fresh.keyDown(KEY.AltRight, 0)
    expect(fresh.keyUp(KEY.AltRight, 300)).toEqual({ type: 'stop' })
  })

  test('autorepeat ignored', () => {
    c.keyDown(KEY.AltRight, 0)
    expect(c.keyDown(KEY.AltRight, 40)).toBeNull()
    expect(c.keyDown(KEY.AltRight, 80)).toBeNull()
  })

  test('escape cancels, then fresh start', () => {
    c.keyDown(KEY.AltRight, 0)
    c.keyUp(KEY.AltRight, 100)
    expect(c.keyDown(KEY.Escape, 500)).toEqual({ type: 'cancel' })
    c.keyUp(KEY.Escape, 550)
    expect(c.keyDown(KEY.AltRight, 900)?.type).toBe('start')
  })

  test('escape when idle', () => {
    expect(c.keyDown(KEY.Escape, 0)).toBeNull()
  })

  test('edit chord', () => {
    expect(c.keyDown(KEY.Shift, 0)).toBeNull()
    expect(c.keyDown(KEY.AltRight, 50)).toEqual({ type: 'start', action: { kind: 'edit' } })
  })

  test('shift after dictate start ignored', () => {
    c.keyDown(KEY.AltRight, 0)
    expect(c.keyDown(KEY.Shift, 100)).toBeNull()
  })

  test('mode hotkey', () => {
    c.keyDown(KEY.Ctrl, 0)
    expect(c.keyDown(KEY.Digit1, 10)).toEqual({
      type: 'start',
      action: { kind: 'dictate', modeId: 'm1' }
    })
  })

  test('notifyStopped resets toggle', () => {
    c.keyDown(KEY.AltRight, 0)
    c.keyUp(KEY.AltRight, 120)
    c.notifyStopped()
    expect(c.keyDown(KEY.AltRight, 2000)?.type).toBe('start')
  })

  test('missed keyup while toggled-stop: next press after gap starts', () => {
    c.keyDown(KEY.AltRight, 0)
    c.keyUp(KEY.AltRight, 100)
    expect(c.keyDown(KEY.AltRight, 2000)).toEqual({ type: 'stop' })
    expect(c.keyDown(KEY.AltRight, 5000)?.type).toBe('start')
  })

  test('missed keyup while holding: press after gap stops', () => {
    c.keyDown(KEY.AltRight, 0)
    expect(c.keyDown(KEY.AltRight, 3000)).toEqual({ type: 'stop' })
  })

  test('held key with ignored autorepeats is never stale', () => {
    c.keyDown(KEY.AltRight, 0)
    for (let t = 100; t <= 3000; t += 100) expect(c.keyDown(KEY.AltRight, t)).toBeNull()
    expect(c.keyUp(KEY.AltRight, 3100)).toEqual({ type: 'stop' })
  })

  test('chord order does not matter', () => {
    c.keyDown(KEY.AltRight, 0)
    c.keyUp(KEY.AltRight, 900)
    expect(c.keyDown(KEY.Digit1, 1000)).toBeNull()
    expect(c.keyDown(KEY.Ctrl, 1010)?.type).toBe('start')
  })

  test('setBindings applies to next press; pressedKeys is exposed', () => {
    c.setBindings([{ keys: [KEY.Ctrl], action: { kind: 'edit' } }], 100)
    expect(c.keyDown(KEY.AltRight, 0)).toBeNull()
    expect(c.pressedKeys().has(KEY.AltRight)).toBe(true)
    c.keyUp(KEY.AltRight, 10)
    expect(c.keyDown(KEY.Ctrl, 20)).toEqual({ type: 'start', action: { kind: 'edit' } })
  })
})

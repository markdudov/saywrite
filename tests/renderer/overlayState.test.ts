import { describe, expect, test } from 'vitest'
import { overlayReducer, type OverlayView } from '../../src/renderer/overlay/state'
import type { OverlayCommand, OverlayModeChip } from '../../src/shared/ipc'

const mode: OverlayModeChip = { id: 'm1', name: 'Clean', icon: 'sparkles' }
const hidden: OverlayView = { kind: 'hidden', levels: [], modes: [] }
const startCmd: OverlayCommand = {
  type: 'start',
  sessionId: 's1',
  deviceId: 'default',
  mode,
  modes: [mode],
  sounds: true
}

describe('overlayReducer', () => {
  test('start → recording', () => {
    const v = overlayReducer(hidden, startCmd)
    expect(v.kind).toBe('recording')
    expect(v.levels).toEqual([])
    expect(v.mode).toEqual(mode)
    expect(v.modes).toEqual([mode])
  })

  test('tick on recording records startedAt once', () => {
    const r = overlayReducer(hidden, startCmd)
    const t1 = overlayReducer(r, { type: 'tick', now: 1000 })
    const t2 = overlayReducer(t1, { type: 'tick', now: 2000 })
    expect(t1.startedAt).toBe(1000)
    expect(t2.startedAt).toBe(1000)
  })

  test('levels ring keeps last 24', () => {
    let v = overlayReducer(hidden, startCmd)
    for (let i = 0; i < 30; i++) v = overlayReducer(v, { type: 'level', value: i / 100 })
    expect(v.levels).toHaveLength(24)
    expect(v.levels[23]).toBeCloseTo(0.29)
    expect(v.levels[0]).toBeCloseTo(0.06)
  })

  test('levels are ignored outside recording', () => {
    const v = overlayReducer(hidden, { type: 'level', value: 0.5 })
    expect(v.levels).toEqual([])
  })

  test('processing stage', () => {
    const r = overlayReducer(hidden, startCmd)
    const v = overlayReducer(r, { type: 'state', state: 'processing', stage: 'writing' })
    expect(v.kind).toBe('processing')
    expect(v.stage).toBe('writing')
  })

  test('error keeps jobId and message', () => {
    const v = overlayReducer(hidden, {
      type: 'state',
      state: 'error',
      message: 'boom',
      jobId: 'j7'
    })
    expect(v.kind).toBe('error')
    expect(v.message).toBe('boom')
    expect(v.jobId).toBe('j7')
  })

  test('success and empty', () => {
    expect(overlayReducer(hidden, { type: 'state', state: 'success' }).kind).toBe('success')
    expect(overlayReducer(hidden, { type: 'state', state: 'empty' }).kind).toBe('empty')
  })

  test('cancel and hidden hide the overlay and clear levels', () => {
    let v = overlayReducer(hidden, startCmd)
    v = overlayReducer(v, { type: 'level', value: 0.4 })
    const c = overlayReducer(v, { type: 'cancel', sessionId: 's1' })
    expect(c.kind).toBe('hidden')
    expect(c.levels).toEqual([])
    expect(overlayReducer(v, { type: 'state', state: 'hidden' }).kind).toBe('hidden')
  })

  test('stop keeps the pill visible (waiting for processing state)', () => {
    const v = overlayReducer(overlayReducer(hidden, startCmd), { type: 'stop', sessionId: 's1' })
    expect(v.kind).toBe('recording')
  })
})

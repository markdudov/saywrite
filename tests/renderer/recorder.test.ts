import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  Recorder,
  type CaptureNodeLike,
  type ContextLike,
  type RecorderDeps,
  type StreamLike
} from '../../src/renderer/overlay/recorderCore'
import { createSessionController } from '../../src/renderer/overlay/sessionController'
import type { OverlayToMain } from '../../src/shared/ipc'

function deferred<T = void>(): {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
} {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

type FakeStream = StreamLike & { stopped: number }
const makeStream = (): FakeStream => {
  const s = { stopped: 0, getTracks: () => [{ stop: () => void s.stopped++ }] }
  return s
}

type FakeCtx = ContextLike & { closed: boolean; node: CaptureNodeLike }

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function setup(opts: { worklet?: Promise<void> } = {}) {
  const gum: ReturnType<typeof deferred<StreamLike>>[] = []
  const streams: FakeStream[] = []
  const ctxs: FakeCtx[] = []
  const deps: RecorderDeps = {
    getUserMedia: () => {
      const d = deferred<StreamLike>()
      gum.push(d)
      return d.promise
    },
    createContext() {
      const node: CaptureNodeLike = {
        port: {
          onmessage: null,
          postMessage(m) {
            if (m === 'flush')
              queueMicrotask(() => node.port.onmessage?.({ data: { flushed: true } }))
          }
        },
        disconnect: () => undefined
      }
      const ctx: FakeCtx = {
        closed: false,
        node,
        get state() {
          return ctx.closed ? 'closed' : 'running'
        },
        close: async () => void (ctx.closed = true),
        loadWorklet: () => opts.worklet ?? Promise.resolve(),
        createCaptureNode: () => node
      }
      ctxs.push(ctx)
      return ctx
    }
  }
  const grant = (i = 0): FakeStream => {
    const s = makeStream()
    streams[i] = s
    gum[i].resolve(s)
    return s
  }
  return { deps, gum, streams, ctxs, grant }
}

const flushMicrotasks = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function controllerFor(rec: Recorder) {
  const sent: OverlayToMain[] = []
  const cueLog: string[] = []
  const c = createSessionController({
    recorder: rec,
    send: (m) => sent.push(m),
    dispatch: () => undefined,
    cues: {
      start: () => cueLog.push('start'),
      stop: () => cueLog.push('stop'),
      error: () => cueLog.push('error')
    },
    micErrorText: () => 'mic'
  })
  const start = (id: string, sounds = false): void =>
    c.handle({
      type: 'start',
      sessionId: id,
      deviceId: 'default',
      mode: { id: 'm', name: 'M', icon: 'i' },
      modes: [],
      sounds
    })
  return { c, sent, cueLog, start }
}

afterEach(() => vi.useRealTimers())

describe('Recorder lifecycle', () => {
  test('captures blocks and returns Int16 PCM, flushing the tail', async () => {
    const h = setup()
    const rec = new Recorder(h.deps)
    const p = rec.start('default', () => undefined)
    h.grant()
    await p
    h.ctxs[0].node.port.onmessage?.({ data: new Float32Array([0, 1, -1]) })
    const r = await rec.stop()
    expect(new Int16Array(r.pcm)).toEqual(new Int16Array([0, 32767, -32768]))
    expect(h.streams[0].stopped).toBe(1)
    expect(h.ctxs[0].closed).toBe(true)
  })

  test('stop during pending getUserMedia → one empty reply, late stream is stopped', async () => {
    const h = setup()
    const rec = new Recorder(h.deps)
    const { c, sent, start } = controllerFor(rec)
    start('s1')
    c.handle({ type: 'stop', sessionId: 's1' })
    await flushMicrotasks()
    expect(sent).toEqual([]) // still waiting for the permission prompt
    const stream = h.grant()
    await flushMicrotasks()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ type: 'audio', sessionId: 's1' })
    expect((sent[0] as { pcm: ArrayBuffer }).pcm.byteLength).toBe(0)
    expect(stream.stopped).toBe(1)
    expect(h.ctxs.every((x) => x.closed)).toBe(true)
  })

  test('stop gives up waiting after 5 s and aborts the pending start', async () => {
    vi.useFakeTimers()
    const h = setup()
    const rec = new Recorder(h.deps)
    const { c, sent, start } = controllerFor(rec)
    start('s1')
    c.handle({ type: 'stop', sessionId: 's1' })
    await vi.advanceTimersByTimeAsync(5001)
    expect(sent).toHaveLength(1)
    const stream = h.grant()
    await vi.advanceTimersByTimeAsync(10)
    expect(stream.stopped).toBe(1) // late stream is released
    expect(sent).toHaveLength(1)
  })

  test('cancel during pending getUserMedia → no reply, stream stopped', async () => {
    const h = setup()
    const rec = new Recorder(h.deps)
    const { c, sent, start } = controllerFor(rec)
    start('s1')
    c.handle({ type: 'cancel', sessionId: 's1' })
    const stream = h.grant()
    await flushMicrotasks()
    expect(sent).toEqual([])
    expect(stream.stopped).toBe(1)
  })

  test('addModule failure after stop → exactly one reply, resources released', async () => {
    const worklet = deferred()
    const h = setup({ worklet: worklet.promise })
    const rec = new Recorder(h.deps)
    const { c, sent, start } = controllerFor(rec)
    start('s1')
    const stream = h.grant()
    await flushMicrotasks()
    c.handle({ type: 'stop', sessionId: 's1' })
    worklet.reject(new Error('addModule failed'))
    await flushMicrotasks()
    await flushMicrotasks()
    expect(sent).toHaveLength(1)
    expect(sent[0].type).toBe('audioError')
    expect(stream.stopped).toBe(1)
    expect(h.ctxs[0].closed).toBe(true)
  })

  test('second start while first pending → first stream released, second works', async () => {
    const h = setup()
    const rec = new Recorder(h.deps)
    const p1 = rec.start('default', () => undefined)
    const p2 = rec.start('default', () => undefined)
    const first = h.grant(0)
    await p1 // aborted silently
    expect(first.stopped).toBe(1)
    const second = h.grant(1)
    await p2
    expect(second.stopped).toBe(0)
    await rec.cancel()
    expect(second.stopped).toBe(1)
  })

  test('start failure → exactly one audioError; later stop adds nothing', async () => {
    const h = setup()
    const rec = new Recorder(h.deps)
    const { c, sent, cueLog, start } = controllerFor(rec)
    start('s1', true)
    h.gum[0].reject(new Error('denied'))
    await flushMicrotasks()
    c.handle({ type: 'stop', sessionId: 's1' })
    await flushMicrotasks()
    expect(sent).toEqual([{ type: 'audioError', sessionId: 's1', message: 'denied' }])
    expect(cueLog.filter((x) => x === 'error')).toHaveLength(1)
  })

  test('stale start failure does not touch a newer session', async () => {
    const h = setup()
    const rec = new Recorder(h.deps)
    const { sent, start } = controllerFor(rec)
    start('s1')
    start('s2')
    h.gum[0].reject(new Error('old'))
    await flushMicrotasks()
    expect(sent).toEqual([])
  })

  test('error cue still plays after stop', async () => {
    const h = setup()
    const rec = new Recorder(h.deps)
    const { c, cueLog, start } = controllerFor(rec)
    start('s1', true)
    const p = Promise.resolve()
    h.grant()
    await p
    await flushMicrotasks()
    c.handle({ type: 'stop', sessionId: 's1' })
    await flushMicrotasks()
    c.handle({ type: 'state', state: 'error', message: 'x', jobId: null })
    expect(cueLog).toEqual(['start', 'stop', 'error'])
  })
})

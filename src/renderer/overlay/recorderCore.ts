// Recorder lifecycle with injected media primitives so it can be unit-tested in Node.
// Rules: every await in start() re-checks the generation token and releases what it opened
// when aborted; stop()/cancel() abort an in-flight start; the mic is never left open.
import { floatToInt16 } from '../../shared/audio/analysis'

export const SAMPLE_RATE = 16000
export const LEVEL_INTERVAL_MS = 50
export const STOP_WAIT_START_MS = 5000
const FLUSH_WAIT_MS = 200

export type RecorderResult = { pcm: ArrayBuffer; sampleRate: 16000 }

export type StreamLike = { getTracks(): { stop(): void }[] }
export type CaptureNodeLike = {
  port: { onmessage: ((e: { data: unknown }) => void) | null; postMessage(m: unknown): void }
  disconnect(): void
}
export type ContextLike = {
  state: string
  close(): Promise<void>
  loadWorklet(): Promise<void>
  createCaptureNode(stream: StreamLike): CaptureNodeLike
}
export type RecorderDeps = {
  getUserMedia(deviceId: string): Promise<StreamLike>
  createContext(): ContextLike
}

type Active = {
  stream: StreamLike
  ctx: ContextLike
  node: CaptureNodeLike
  timer: ReturnType<typeof setInterval>
  blocks: Float32Array[]
  pending: Float32Array[]
}

async function closeCtx(ctx: ContextLike | null): Promise<void> {
  if (!ctx || ctx.state === 'closed') return
  try {
    await ctx.close()
  } catch {
    /* already closed */
  }
}

function stopStream(s: StreamLike | null): void {
  s?.getTracks().forEach((t) => t.stop())
}

function rmsLevel(pending: Float32Array[]): number {
  let sum = 0
  let n = 0
  for (const b of pending) {
    for (let i = 0; i < b.length; i++) sum += b[i] * b[i]
    n += b.length
  }
  if (n === 0) return 0
  const db = 20 * Math.log10(Math.max(Math.sqrt(sum / n), 1e-5))
  return Math.max(0, Math.min(1, (db + 50) / 50)) // -50..0 dBFS → 0..1
}

export class Recorder {
  private gen = 0
  private inflight: Promise<void> | null = null
  private active: Active | null = null

  constructor(private readonly deps: RecorderDeps) {}

  /**
   * Resolves once capturing, or silently if aborted by stop/cancel/a newer start.
   * Rejects (after releasing everything) if the microphone cannot be opened.
   */
  start(deviceId: string, onLevel: (v: number) => void): Promise<void> {
    const token = ++this.gen
    void this.teardown()
    const p = this.doStart(token, deviceId, onLevel)
    this.inflight = p
    return p
  }

  private async doStart(
    token: number,
    deviceId: string,
    onLevel: (v: number) => void
  ): Promise<void> {
    let stream: StreamLike | null = null
    let ctx: ContextLike | null = null
    try {
      stream = await this.deps.getUserMedia(deviceId)
      if (token !== this.gen) return await this.abandon(stream, ctx)
      ctx = this.deps.createContext()
      await ctx.loadWorklet()
      if (token !== this.gen) return await this.abandon(stream, ctx)
      const node = ctx.createCaptureNode(stream)
      const a: Active = {
        stream,
        ctx,
        node,
        blocks: [],
        pending: [],
        timer: setInterval(() => {
          const lvl = rmsLevel(a.pending)
          a.pending = []
          onLevel(lvl)
        }, LEVEL_INTERVAL_MS)
      }
      node.port.onmessage = (ev) => {
        if (ev.data instanceof Float32Array) {
          a.blocks.push(ev.data)
          a.pending.push(ev.data)
        }
      }
      this.active = a
    } catch (err) {
      await this.abandon(stream, ctx)
      if (token !== this.gen) return // aborted: the caller no longer wants an answer
      throw err
    }
  }

  private async abandon(stream: StreamLike | null, ctx: ContextLike | null): Promise<void> {
    stopStream(stream)
    await closeCtx(ctx)
  }

  /** Waits (max 5 s) for a pending start, then returns PCM; empty PCM if nothing was captured. */
  async stop(): Promise<RecorderResult> {
    const inflight = this.inflight
    if (inflight && !this.active) {
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        inflight.catch(() => undefined),
        new Promise<void>((r) => (timer = setTimeout(r, STOP_WAIT_START_MS)))
      ])
      clearTimeout(timer)
    }
    const a = this.active
    if (!a) {
      this.gen++ // abort a start that is still pending after the cap
      return { pcm: new ArrayBuffer(0), sampleRate: SAMPLE_RATE }
    }
    this.active = null
    clearInterval(a.timer)
    await this.flush(a)
    stopStream(a.stream)
    a.node.disconnect()
    await closeCtx(a.ctx)
    const total = a.blocks.reduce((n, b) => n + b.length, 0)
    const all = new Float32Array(total)
    let off = 0
    for (const b of a.blocks) {
      all.set(b, off)
      off += b.length
    }
    return { pcm: floatToInt16(all).buffer as ArrayBuffer, sampleRate: SAMPLE_RATE }
  }

  /** Aborts any pending start and releases the mic immediately. No result. */
  async cancel(): Promise<void> {
    this.gen++
    await this.teardown()
  }

  // The worklet answers 'flush' after every earlier block has been posted, so the tail is kept.
  private flush(a: Active): Promise<void> {
    return new Promise<void>((resolve) => {
      const t = setTimeout(resolve, FLUSH_WAIT_MS)
      const prev = a.node.port.onmessage
      a.node.port.onmessage = (ev) => {
        prev?.(ev)
        const d = ev.data as { flushed?: boolean } | undefined
        if (d && typeof d === 'object' && 'flushed' in d) {
          clearTimeout(t)
          resolve()
        }
      }
      a.node.port.postMessage('flush')
    })
  }

  private async teardown(): Promise<void> {
    const a = this.active
    this.active = null
    if (!a) return
    clearInterval(a.timer)
    stopStream(a.stream)
    a.node.disconnect()
    await closeCtx(a.ctx)
  }
}

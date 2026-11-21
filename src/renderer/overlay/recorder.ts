import { floatToInt16 } from '../../shared/audio/analysis'
import workletUrl from './pcm-worklet?worker&url'

export const SAMPLE_RATE = 16000
const LEVEL_INTERVAL_MS = 50

export type RecorderResult = { pcm: ArrayBuffer; sampleRate: 16000 }

export class Recorder {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private blocks: Float32Array[] = []
  private levelTimer: ReturnType<typeof setInterval> | null = null
  private pending: Float32Array[] = []

  /** Throws if the microphone or audio graph cannot be opened; resources are released first. */
  async start(deviceId: string, onLevel: (v: number) => void): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId && deviceId !== 'default' ? { exact: deviceId } : undefined,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: true,
          autoGainControl: true
        }
      })
      this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
      await this.ctx.audioWorklet.addModule(workletUrl)
      const source = this.ctx.createMediaStreamSource(this.stream)
      const node = new AudioWorkletNode(this.ctx, 'pcm-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1
      })
      node.port.onmessage = (ev: MessageEvent<Float32Array>) => {
        this.blocks.push(ev.data)
        this.pending.push(ev.data)
      }
      source.connect(node)
      this.levelTimer = setInterval(() => onLevel(this.takeLevel()), LEVEL_INTERVAL_MS)
    } catch (err) {
      await this.release()
      throw err
    }
  }

  /** Stops capture, releases the mic and returns Int16 mono PCM (null if nothing was started). */
  async stop(): Promise<RecorderResult | null> {
    if (!this.ctx && !this.stream) return null
    const blocks = this.blocks
    await this.release()
    const total = blocks.reduce((n, b) => n + b.length, 0)
    const all = new Float32Array(total)
    let off = 0
    for (const b of blocks) {
      all.set(b, off)
      off += b.length
    }
    return { pcm: floatToInt16(all).buffer as ArrayBuffer, sampleRate: SAMPLE_RATE }
  }

  async cancel(): Promise<void> {
    await this.release()
  }

  private takeLevel(): number {
    let sum = 0
    let n = 0
    for (const b of this.pending) {
      for (let i = 0; i < b.length; i++) sum += b[i] * b[i]
      n += b.length
    }
    this.pending = []
    if (n === 0) return 0
    const rms = Math.sqrt(sum / n)
    // ~ -50 dBFS .. 0 dBFS mapped to 0..1
    const db = 20 * Math.log10(Math.max(rms, 1e-5))
    return Math.max(0, Math.min(1, (db + 50) / 50))
  }

  private async release(): Promise<void> {
    if (this.levelTimer) clearInterval(this.levelTimer)
    this.levelTimer = null
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    const ctx = this.ctx
    this.ctx = null
    this.blocks = []
    this.pending = []
    if (ctx && ctx.state !== 'closed') {
      try {
        await ctx.close()
      } catch {
        /* already closed */
      }
    }
  }
}

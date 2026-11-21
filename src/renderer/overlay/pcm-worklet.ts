// Runs inside AudioWorkletGlobalScope: forwards each mono input block to the main thread.
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(name: string, ctor: unknown): void

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    // Messages are ordered with the blocks posted above, so this reply marks "all blocks sent".
    this.port.onmessage = (e: MessageEvent): void => {
      if (e.data === 'flush') this.port.postMessage({ flushed: true })
    }
  }

  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0]
    if (ch && ch.length > 0) {
      const copy = new Float32Array(ch) // the engine reuses its buffer
      this.port.postMessage(copy, [copy.buffer])
    }
    return true
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor)
export {}

import workletUrl from './pcm-worklet?worker&url'
import {
  Recorder,
  SAMPLE_RATE,
  type CaptureNodeLike,
  type ContextLike,
  type RecorderDeps,
  type StreamLike
} from './recorderCore'

export { Recorder, SAMPLE_RATE }
export type { RecorderResult } from './recorderCore'

const browserDeps: RecorderDeps = {
  getUserMedia: (deviceId): Promise<StreamLike> =>
    navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId && deviceId !== 'default' ? { exact: deviceId } : undefined,
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: true,
        autoGainControl: true
      }
    }),
  createContext(): ContextLike {
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
    return {
      get state() {
        return ctx.state
      },
      close: () => ctx.close(),
      loadWorklet: () => ctx.audioWorklet.addModule(workletUrl),
      createCaptureNode(stream): CaptureNodeLike {
        const source = ctx.createMediaStreamSource(stream as MediaStream)
        const node = new AudioWorkletNode(ctx, 'pcm-capture', {
          numberOfInputs: 1,
          numberOfOutputs: 0,
          channelCount: 1
        })
        source.connect(node)
        return {
          port: node.port as unknown as CaptureNodeLike['port'],
          disconnect: () => {
            source.disconnect()
            node.disconnect()
          }
        }
      }
    }
  }
}

export function createRecorder(): Recorder {
  return new Recorder(browserDeps)
}

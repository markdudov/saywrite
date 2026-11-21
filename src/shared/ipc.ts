// IPC contract between the main process and the overlay renderer.

export const OVERLAY_COMMAND_CHANNEL = 'overlay:command'
export const OVERLAY_TO_MAIN_CHANNEL = 'overlay:toMain'

export type OverlayModeChip = { id: string; name: string; icon: string }

export type OverlayCommand =
  | {
      type: 'start'
      sessionId: string
      deviceId: string
      mode: OverlayModeChip
      modes: OverlayModeChip[]
      sounds: boolean
    }
  | { type: 'stop'; sessionId: string }
  | { type: 'cancel'; sessionId: string }
  | { type: 'state'; state: 'processing'; stage: 'transcribing' | 'writing' }
  | { type: 'state'; state: 'success' | 'empty' | 'hidden' }
  | { type: 'state'; state: 'error'; message: string; jobId: string | null }

export type OverlayToMain =
  | { type: 'audio'; sessionId: string; pcm: ArrayBuffer /* Int16 mono */; sampleRate: 16000 }
  | { type: 'audioError'; sessionId: string; message: string }
  | { type: 'cancelClicked' }
  | { type: 'switchMode'; modeId: string }
  | { type: 'retry'; jobId: string }
  | { type: 'copy'; jobId: string }
  | { type: 'interactive'; value: boolean }
  /** Sent after a drag; main reads win.getPosition() itself, so no coordinates are needed. */
  | { type: 'moved' }

/** The API exposed on window.saywriteOverlay by the overlay preload. */
export type SaywriteOverlayApi = {
  onCommand(cb: (c: OverlayCommand) => void): () => void
  send(msg: OverlayToMain): void
}

// Per-session logic of the overlay renderer, free of React/DOM so it can be tested in Node.
// Invariant: every 'stop' command is answered with exactly one 'audio' or one 'audioError'.
import type { OverlayCommand, OverlayToMain } from '../../shared/ipc'
import type { OverlayEvent } from './state'
import type { RecorderResult } from './recorderCore'

export type RecorderLike = {
  start(deviceId: string, onLevel: (v: number) => void): Promise<void>
  stop(): Promise<RecorderResult>
  cancel(): Promise<void>
}

export type SessionDeps = {
  recorder: RecorderLike
  send(m: OverlayToMain): void
  dispatch(e: OverlayEvent): void
  cues: { start(): void; stop(): void; error(): void }
  micErrorText(): string
}

type Session = { id: string; stopped: boolean; answered: boolean; cancelled: boolean }

export function createSessionController(d: SessionDeps): { handle(c: OverlayCommand): void } {
  let session: Session | null = null
  // Outlives the session (stop clears it) so the later error cue still plays; reset on hidden/start.
  let sounds = false
  let errorCued = false

  const cueError = (): void => {
    if (sounds && !errorCued) {
      errorCued = true
      d.cues.error()
    }
  }

  function start(c: Extract<OverlayCommand, { type: 'start' }>): void {
    const s: Session = { id: c.sessionId, stopped: false, answered: false, cancelled: false }
    session = s
    sounds = c.sounds
    errorCued = false
    if (sounds) d.cues.start()
    d.recorder
      .start(c.deviceId, (value) => {
        if (session === s) d.dispatch({ type: 'level', value })
      })
      .catch((err: unknown) => {
        if (session !== s || s.cancelled || s.answered) return // stale or already answered
        s.answered = true
        cueError()
        d.dispatch({ type: 'state', state: 'error', message: d.micErrorText(), jobId: null })
        d.send({
          type: 'audioError',
          sessionId: s.id,
          message: err instanceof Error ? err.message : String(err)
        })
      })
  }

  async function stop(c: Extract<OverlayCommand, { type: 'stop' }>): Promise<void> {
    const s = session
    if (!s || s.id !== c.sessionId || s.stopped || s.cancelled) return
    s.stopped = true
    if (sounds) d.cues.stop()
    const r = await d.recorder.stop()
    if (s.answered || s.cancelled) return
    s.answered = true
    d.send({ type: 'audio', sessionId: s.id, pcm: r.pcm, sampleRate: r.sampleRate })
  }

  return {
    handle(c) {
      d.dispatch(c)
      switch (c.type) {
        case 'start':
          start(c)
          break
        case 'stop':
          void stop(c)
          break
        case 'cancel':
          if (session) session.cancelled = true
          session = null
          void d.recorder.cancel()
          break
        case 'state':
          if (c.state === 'error') cueError()
          if (c.state === 'hidden') {
            sounds = false
            errorCued = false
          }
          break
      }
    }
  }
}

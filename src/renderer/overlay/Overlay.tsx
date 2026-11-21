import { useEffect, useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { OverlayCommand, OverlayToMain, SaywriteOverlayApi } from '../../shared/ipc'
import { cues } from './cues'
import { Recorder } from './recorder'
import { initialView, overlayReducer } from './state'
import { Waveform } from './Waveform'

declare global {
  interface Window {
    saywriteOverlay: SaywriteOverlayApi
  }
}

const SUCCESS_MS = 600
const EMPTY_MS = 1500
const ERROR_MS = 8000

function formatTimer(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function Overlay(): React.JSX.Element | null {
  const { t } = useTranslation()
  const [view, dispatch] = useReducer(overlayReducer, initialView)
  const [now, setNow] = useState(() => Date.now())
  const [listOpen, setListOpen] = useState(false)
  const recorder = useRef(new Recorder())
  const session = useRef<{ id: string; sounds: boolean } | null>(null)
  const send = (m: OverlayToMain): void => window.saywriteOverlay.send(m)

  useEffect(() => {
    const api = window.saywriteOverlay
    const rec = recorder.current
    return api.onCommand((c: OverlayCommand) => {
      dispatch(c)
      if (c.type === 'start') {
        session.current = { id: c.sessionId, sounds: c.sounds }
        setListOpen(false)
        if (c.sounds) cues.start()
        rec
          .start(c.deviceId, (value) => dispatch({ type: 'level', value }))
          .catch((err: unknown) => {
            session.current = null
            if (c.sounds) cues.error()
            dispatch({ type: 'state', state: 'error', message: t('overlay.micError'), jobId: null })
            api.send({
              type: 'audioError',
              sessionId: c.sessionId,
              message: err instanceof Error ? err.message : String(err)
            })
          })
      } else if (c.type === 'stop') {
        const s = session.current
        session.current = null
        if (s?.sounds) cues.stop()
        void rec.stop().then((r) => {
          if (r && s) {
            api.send({
              type: 'audio',
              sessionId: c.sessionId,
              pcm: r.pcm,
              sampleRate: r.sampleRate
            })
          }
        })
      } else if (c.type === 'cancel') {
        session.current = null
        void rec.cancel()
      } else if (c.type === 'state' && c.state === 'error' && session.current?.sounds) {
        cues.error()
      }
    })
  }, [t])

  // Release the microphone if the page goes away.
  useEffect(() => {
    const rec = recorder.current
    return () => void rec.cancel()
  }, [])

  // Timer tick while recording.
  useEffect(() => {
    if (view.kind !== 'recording') return
    dispatch({ type: 'tick', now: Date.now() })
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [view.kind])

  // Auto-hide timers for transient states.
  useEffect(() => {
    const ms = { success: SUCCESS_MS, empty: EMPTY_MS, error: ERROR_MS }[
      view.kind as 'success' | 'empty' | 'error'
    ]
    if (!ms) return
    const id = setTimeout(() => dispatch({ type: 'state', state: 'hidden' }), ms)
    return () => clearTimeout(id)
  }, [view.kind])

  // Nothing visible means nothing should intercept the mouse.
  useEffect(() => {
    if (view.kind === 'hidden') send({ type: 'interactive', value: false })
  }, [view.kind])

  if (view.kind === 'hidden') return null

  const interactive = (value: boolean) => (): void => send({ type: 'interactive', value })

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-end pb-2">
      {listOpen && view.kind === 'recording' && (
        <ul
          className="mb-2 max-h-36 w-56 overflow-y-auto rounded-xl bg-neutral-900/95 p-1 text-sm text-white shadow-lg"
          onPointerEnter={interactive(true)}
          onPointerLeave={interactive(false)}
        >
          {view.modes.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-white/10"
                onClick={() => {
                  send({ type: 'switchMode', modeId: m.id })
                  setListOpen(false)
                }}
              >
                <span aria-hidden>{m.icon}</span>
                <span className="truncate">{m.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div
        className="flex items-center gap-3 rounded-full bg-neutral-900/95 px-3 py-2 text-sm text-white shadow-lg"
        onPointerEnter={interactive(true)}
        onPointerLeave={interactive(false)}
      >
        <div
          className="drag-region h-5 w-2 cursor-grab rounded bg-white/30"
          title={t('overlay.drag')}
        />
        {view.kind === 'recording' && (
          <>
            <Waveform levels={view.levels} />
            <span className="w-11 tabular-nums">
              {formatTimer(view.startedAt ? now - view.startedAt : 0)}
            </span>
            {view.mode && (
              <button
                type="button"
                className="no-drag rounded-full bg-white/10 px-2 py-0.5 hover:bg-white/20"
                aria-label={t('overlay.mode')}
                onClick={() => setListOpen((o) => !o)}
              >
                <span aria-hidden>{view.mode.icon}</span> {view.mode.name}
              </button>
            )}
            <button
              type="button"
              className="no-drag rounded-full px-1 hover:bg-white/20"
              aria-label={t('overlay.cancel')}
              title={t('overlay.cancel')}
              onClick={() => send({ type: 'cancelClicked' })}
            >
              ✕
            </button>
          </>
        )}
        {view.kind === 'processing' && (
          <>
            <span className="sw-spin inline-block h-4 w-4 rounded-full border-2 border-white/30 border-t-white" />
            <span>
              {view.stage === 'writing' ? t('overlay.writing') : t('overlay.transcribing')}
            </span>
          </>
        )}
        {view.kind === 'success' && <span aria-hidden>✓</span>}
        {view.kind === 'empty' && <span>{t('overlay.empty')}</span>}
        {view.kind === 'error' && (
          <>
            <span className="max-w-[160px] truncate">{view.message}</span>
            {view.jobId && (
              <>
                <button
                  type="button"
                  className="no-drag rounded-full bg-white/10 px-2 py-0.5 hover:bg-white/20"
                  onClick={() => send({ type: 'retry', jobId: view.jobId as string })}
                >
                  {t('overlay.retry')}
                </button>
                <button
                  type="button"
                  className="no-drag rounded-full bg-white/10 px-2 py-0.5 hover:bg-white/20"
                  onClick={() => send({ type: 'copy', jobId: view.jobId as string })}
                >
                  {t('overlay.copy')}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

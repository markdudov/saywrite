import { useEffect, useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { OverlayCommand, OverlayToMain, SaywriteOverlayApi } from '../../shared/ipc'
import { cues } from './cues'
import { createRecorder } from './recorder'
import { createSessionController } from './sessionController'
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
  const hover = useRef({ pill: false, list: false })
  const send = (m: OverlayToMain): void => window.saywriteOverlay.send(m)
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  }, [t])

  useEffect(() => {
    const recorder = createRecorder()
    const controller = createSessionController({
      recorder,
      send: (m) => window.saywriteOverlay.send(m),
      dispatch,
      cues,
      micErrorText: () => tRef.current('overlay.micError')
    })
    const off = window.saywriteOverlay.onCommand((c: OverlayCommand) => {
      if (c.type === 'start') setListOpen(false)
      controller.handle(c)
    })
    // Release the microphone if the page goes away.
    return () => {
      off()
      void recorder.cancel()
    }
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

  // An unmounted element never fires pointerleave: recompute the flag whenever what is on screen
  // changes so the transparent window cannot stay mouse-capturing.
  const listVisible = listOpen && view.kind === 'recording'
  useEffect(() => {
    if (!listVisible) hover.current.list = false
    if (view.kind === 'hidden') hover.current.pill = false
    window.saywriteOverlay.send({
      type: 'interactive',
      value: hover.current.pill || hover.current.list
    })
  }, [listVisible, view.kind])

  if (view.kind === 'hidden') return null

  const setHover = (el: 'pill' | 'list', value: boolean): void => {
    hover.current[el] = value
    send({ type: 'interactive', value: hover.current.pill || hover.current.list })
  }

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-end pb-2">
      {listVisible && (
        <ul
          className="mb-2 max-h-36 w-56 overflow-y-auto rounded-xl bg-neutral-900/95 p-1 text-sm text-white shadow-lg"
          onPointerEnter={() => setHover('list', true)}
          onPointerLeave={() => setHover('list', false)}
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
        onPointerEnter={() => setHover('pill', true)}
        onPointerLeave={() => setHover('pill', false)}
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

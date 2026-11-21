import type { OverlayCommand, OverlayModeChip } from '../../shared/ipc'

export type OverlayView = {
  kind: 'hidden' | 'recording' | 'processing' | 'success' | 'empty' | 'error'
  startedAt?: number
  levels: number[] // last 24, 0..1
  mode?: OverlayModeChip
  modes: OverlayModeChip[]
  stage?: 'transcribing' | 'writing'
  message?: string
  jobId?: string | null
}

export const MAX_LEVELS = 24

export type OverlayEvent =
  OverlayCommand | { type: 'level'; value: number } | { type: 'tick'; now: number }

export const initialView: OverlayView = { kind: 'hidden', levels: [], modes: [] }

export function overlayReducer(v: OverlayView, e: OverlayEvent): OverlayView {
  switch (e.type) {
    case 'start':
      return { kind: 'recording', levels: [], mode: e.mode, modes: e.modes }
    case 'cancel':
      return { ...initialView, modes: v.modes, mode: v.mode }
    case 'stop':
      return v
    case 'level':
      if (v.kind !== 'recording') return v
      return { ...v, levels: [...v.levels, e.value].slice(-MAX_LEVELS) }
    case 'tick':
      if (v.kind !== 'recording' || v.startedAt !== undefined) return v
      return { ...v, startedAt: e.now }
    case 'state':
      switch (e.state) {
        case 'processing':
          return { ...v, kind: 'processing', stage: e.stage }
        case 'success':
        case 'empty':
          return { ...v, kind: e.state }
        case 'hidden':
          return { ...initialView, modes: v.modes, mode: v.mode }
        case 'error':
          return { ...v, kind: 'error', message: e.message, jobId: e.jobId }
      }
  }
}

import type { ProviderErrorKind } from '../providers'
import type { Mode } from './mode'

export type RecordingStatus =
  'transcribing' | 'processing' | 'done' | 'done_raw_fallback' | 'failed' | 'empty'

export type CapturedContext = {
  app: { name: string; id: string } | null
  clipboard: string | null
  selection: string | null
}

export type EnvironmentInfo = {
  userName: string
  nowIso: string
  timeZone: string
  osLocale: string
}

export type Variant = 'transform' | 'edit' | 'write'

export type RecordingRow = {
  id: string
  createdAt: number
  status: RecordingStatus
  modeId: string
  modeName: string
  appName: string | null
  appId: string | null
  durationMs: number
  rawText: string | null
  finalText: string | null
  sttProvider: string | null
  sttModel: string | null
  llmProvider: string | null
  llmModel: string | null
  sttCostUsd: number | null
  llmCostUsd: number | null
  errorKind: ProviderErrorKind | null
  errorMessage: string | null
  hasAudio: boolean
}

export type RecordingMeta = RecordingRow & {
  schemaVersion: 1
  mode: Mode
  variant: Variant
  context: CapturedContext
  env: EnvironmentInfo
  timings: { sttMs: number | null; llmMs: number | null }
  tokens: { input: number; output: number } | null
}

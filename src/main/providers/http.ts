import { ProviderError, kindForStatus } from './errors'

const MAX_MESSAGE = 300

function extractErrorText(raw: string): string {
  let text = raw
  try {
    const j = JSON.parse(raw) as Record<string, unknown>
    const err = j.error
    const candidates: unknown[] = [
      typeof err === 'object' && err !== null
        ? (err as Record<string, unknown>).message
        : undefined,
      err,
      j.detail,
      j.message
    ]
    const found = candidates.find((c) => typeof c === 'string' && c.length > 0)
    if (typeof found === 'string') text = found
  } catch {
    // not JSON: use raw text
  }
  return text.trim().slice(0, MAX_MESSAGE)
}

function reasonText(reason: unknown): string {
  if (reason instanceof Error) return reason.message
  return typeof reason === 'string' ? reason : 'aborted'
}

function toProviderError(
  e: unknown,
  provider: string,
  timeoutMs: number,
  timedOut: boolean,
  signal: AbortSignal | undefined
): ProviderError {
  if (timedOut) {
    return new ProviderError(
      'timeout',
      provider,
      `Request to ${provider} timed out after ${timeoutMs} ms`
    )
  }
  if (signal?.aborted) {
    return new ProviderError(
      'timeout',
      provider,
      `Request to ${provider} aborted: ${reasonText(signal.reason)}`,
      undefined,
      { cancelled: true }
    )
  }
  return new ProviderError(
    'network',
    provider,
    `Network error talking to ${provider}: ${e instanceof Error ? e.message : String(e)}`
  )
}

export async function requestJson<T>(
  url: string,
  init: RequestInit & { provider: string; timeoutMs: number; signal?: AbortSignal }
): Promise<T> {
  const { provider, timeoutMs, signal, ...rest } = init
  const timer = new AbortController()
  let timedOut = false
  const handle = setTimeout(() => {
    timedOut = true
    timer.abort()
  }, timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timer.signal]) : timer.signal
  try {
    let res: Response
    let body: string
    try {
      res = await fetch(url, { ...rest, signal: combined })
      body = await res.text()
    } catch (e) {
      throw toProviderError(e, provider, timeoutMs, timedOut, signal)
    }
    if (!res.ok) {
      throw new ProviderError(
        kindForStatus(res.status),
        provider,
        `HTTP ${res.status} from ${provider}: ${extractErrorText(body)}`,
        res.status
      )
    }
    try {
      return JSON.parse(body) as T
    } catch {
      throw new ProviderError(
        'server',
        provider,
        `Invalid JSON response from ${provider}`,
        res.status
      )
    }
  } finally {
    clearTimeout(handle)
  }
}

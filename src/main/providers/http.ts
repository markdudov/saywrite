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
    try {
      res = await fetch(url, { ...rest, signal: combined })
    } catch (e) {
      if (timedOut)
        throw new ProviderError(
          'timeout',
          provider,
          `Request to ${provider} timed out after ${timeoutMs} ms`
        )
      if (signal?.aborted)
        throw new ProviderError(
          'timeout',
          provider,
          `Request to ${provider} aborted: ${reasonText(signal.reason)}`
        )
      throw new ProviderError(
        'network',
        provider,
        `Network error contacting ${provider}: ${e instanceof Error ? e.message : String(e)}`
      )
    }
    let body: string
    try {
      body = await res.text()
    } catch (e) {
      if (timedOut)
        throw new ProviderError(
          'timeout',
          provider,
          `Request to ${provider} timed out after ${timeoutMs} ms`
        )
      if (signal?.aborted)
        throw new ProviderError(
          'timeout',
          provider,
          `Request to ${provider} aborted: ${reasonText(signal.reason)}`
        )
      throw new ProviderError(
        'network',
        provider,
        `Network error reading ${provider} response: ${e instanceof Error ? e.message : String(e)}`
      )
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

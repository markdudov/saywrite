import type { ProviderErrorKind } from '@shared/providers'

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind
  readonly provider: string
  readonly status?: number

  constructor(kind: ProviderErrorKind, provider: string, message: string, status?: number) {
    super(message)
    this.name = 'ProviderError'
    this.kind = kind
    this.provider = provider
    this.status = status
  }

  get retryable(): boolean {
    return (
      this.kind === 'rate_limit' ||
      this.kind === 'network' ||
      this.kind === 'timeout' ||
      this.kind === 'server'
    )
  }
}

export function kindForStatus(status: number): ProviderErrorKind {
  if (status === 401 || status === 403) return 'auth'
  if (status === 429) return 'rate_limit'
  if (status >= 500) return 'server'
  return 'bad_request'
}

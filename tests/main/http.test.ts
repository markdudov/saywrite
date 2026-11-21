import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { ProviderError } from '../../src/main/providers/errors'
import { requestJson } from '../../src/main/providers/http'

let server: Server
let base = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? ''
    if (url === '/hang') return
    if (url === '/stall') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.write('{"a":')
      return
    }
    if (url === '/badjson') {
      res.end('not json')
      return
    }
    if (url === '/strerr') {
      res.statusCode = 400
      res.setHeader('content-type', 'application/json')
      res.end('{"error":"string failure"}')
      return
    }
    if (url === '/rawerr') {
      res.statusCode = 502
      res.end('upstream exploded')
      return
    }
    if (url === '/ok') {
      res.setHeader('content-type', 'application/json')
      res.end('{"a":1}')
      return
    }
    const m = /^\/s\/(\d+)/.exec(url)
    if (m) {
      res.statusCode = Number(m[1])
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: { message: 'bad thing ' + 'x'.repeat(400) } }))
      return
    }
    res.statusCode = 404
    res.end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => {
  server.closeAllConnections()
  server.close()
})

describe('requestJson', () => {
  test('returns parsed json', async () => {
    await expect(requestJson(`${base}/ok`, { provider: 'groq', timeoutMs: 1000 })).resolves.toEqual(
      { a: 1 }
    )
  })
  test('timeout aborts a hanging request', async () => {
    await expect(
      requestJson(`${base}/hang`, { provider: 'groq', timeoutMs: 100 })
    ).rejects.toMatchObject({
      kind: 'timeout',
      provider: 'groq'
    })
  })
  test('status mapping', async () => {
    const kind = async (s: number): Promise<ProviderError> =>
      requestJson(`${base}/s/${s}`, { provider: 'groq', timeoutMs: 1000 }).then(
        () => {
          throw new Error('expected rejection')
        },
        (e: ProviderError) => e
      )
    expect((await kind(401)).kind).toBe('auth')
    const rl = await kind(429)
    expect(rl.kind).toBe('rate_limit')
    expect(rl.retryable).toBe(true)
    expect((await kind(400)).kind).toBe('bad_request')
    const s = await kind(503)
    expect(s.kind).toBe('server')
    expect(s.status).toBe(503)
    expect(s.retryable).toBe(true)
    expect(s.message.startsWith('HTTP 503 from groq: bad thing')).toBe(true)
    expect(s.message.length).toBeLessThanOrEqual(300 + 'HTTP 503 from groq: '.length)
  })
  test('network error', async () => {
    const tmp = createServer()
    await new Promise<void>((r) => tmp.listen(0, '127.0.0.1', r))
    const port = (tmp.address() as AddressInfo).port
    await new Promise<void>((r) => tmp.close(() => r()))
    await expect(
      requestJson(`http://127.0.0.1:${port}/`, { provider: 'openai', timeoutMs: 1000 })
    ).rejects.toMatchObject({ kind: 'network' })
  })
  test('caller abort propagates', async () => {
    const ac = new AbortController()
    setTimeout(() => ac.abort(new Error('user cancelled')), 20)
    const err = await requestJson(`${base}/hang`, {
      provider: 'groq',
      timeoutMs: 5000,
      signal: ac.signal
    }).then(
      () => null,
      (e) => e
    )
    expect(err).toBeInstanceOf(ProviderError)
    expect(err.message).toContain('user cancelled')
  })
  test('timeout while reading the body is a non-cancelled timeout', async () => {
    const err = await requestJson(`${base}/stall`, { provider: 'groq', timeoutMs: 100 }).then(
      () => null,
      (e) => e
    )
    expect(err).toMatchObject({ kind: 'timeout', cancelled: false })
  })
  test('already-aborted caller signal is cancelled and not retryable', async () => {
    const err = await requestJson(`${base}/ok`, {
      provider: 'groq',
      timeoutMs: 1000,
      signal: AbortSignal.abort(new Error('nope'))
    }).then(
      () => null,
      (e) => e
    )
    expect(err).toBeInstanceOf(ProviderError)
    expect(err.cancelled).toBe(true)
    expect(err.retryable).toBe(false)
  })
  test('caller abort mid-request is cancelled', async () => {
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 20)
    const err = await requestJson(`${base}/hang`, {
      provider: 'groq',
      timeoutMs: 5000,
      signal: ac.signal
    }).then(
      () => null,
      (e) => e
    )
    expect(err.cancelled).toBe(true)
    expect(err.retryable).toBe(false)
  })
  test('invalid JSON on 2xx is a server error', async () => {
    await expect(
      requestJson(`${base}/badjson`, { provider: 'groq', timeoutMs: 1000 })
    ).rejects.toMatchObject({ kind: 'server' })
  })
  test('string error and raw non-JSON bodies appear in the message', async () => {
    await expect(
      requestJson(`${base}/strerr`, { provider: 'groq', timeoutMs: 1000 })
    ).rejects.toThrow('HTTP 400 from groq: string failure')
    await expect(
      requestJson(`${base}/rawerr`, { provider: 'groq', timeoutMs: 1000 })
    ).rejects.toThrow('HTTP 502 from groq: upstream exploded')
  })
})

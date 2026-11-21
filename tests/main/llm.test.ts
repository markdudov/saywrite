import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
  type Mock
} from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import Anthropic from '@anthropic-ai/sdk'
import { createLlmAdapter, llmFor } from '../../src/main/providers/registry'
import {
  FALLBACK_MODELS,
  supportsEffort,
  type AnthropicLike
} from '../../src/main/providers/llm/anthropic'
import { reasoningEffortFor } from '../../src/main/providers/llm/openaiChat'
import { listModels, testKey } from '../../src/main/providers/keyTest'
import type { LlmRequest } from '../../src/main/providers/llm/types'
import { defaultSettings } from '../../src/shared/schemas/settings'

type Seen = {
  method: string
  path: string
  rawUrl: string
  headers: Record<string, string | string[] | undefined>
  body: unknown
}

let server: Server
let base = ''
let last: Seen
let status = 200
let reply: unknown = {}

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      last = {
        method: req.method ?? '',
        path: new URL(req.url ?? '/', 'http://x').pathname,
        rawUrl: req.url ?? '',
        headers: req.headers,
        body: text ? JSON.parse(text) : undefined
      }
      res.statusCode = status
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(reply))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => {
  server.close()
})
beforeEach(() => {
  status = 200
  reply = {
    model: 'served-model',
    choices: [{ message: { content: 'out' } }],
    usage: { prompt_tokens: 11, completion_tokens: 7 }
  }
})

const KEY = 'sk-test-SECRET'
const ask = (model: string, apiKey = KEY): LlmRequest => ({ model, system: 'S', user: 'U', apiKey })

type Fake = AnthropicLike & {
  messages: { create: Mock }
  beta: { messages: { create: Mock } }
}

function fakeAnthropic(res: unknown, models: string[] = []): Fake {
  const fake = {
    messages: { create: vi.fn().mockResolvedValue(res) },
    beta: { messages: { create: vi.fn().mockResolvedValue(res) } },
    models: {
      list: vi.fn().mockImplementation(async function* () {
        for (const id of models) yield { id }
      })
    }
  }
  return fake as unknown as Fake
}

describe('openai-compatible chat', () => {
  test('openai chat shape + reasoning effort', async () => {
    const r = await createLlmAdapter('openai', { baseUrl: `${base}/v1` }).complete(
      ask('gpt-5-mini'),
      { timeoutMs: 2000 }
    )
    expect(last.method).toBe('POST')
    expect(last.rawUrl).toBe('/v1/chat/completions')
    expect(last.rawUrl).not.toContain(KEY)
    expect(last.headers.authorization).toBe(`Bearer ${KEY}`)
    expect(last.body).toEqual({
      model: 'gpt-5-mini',
      messages: [
        { role: 'system', content: 'S' },
        { role: 'user', content: 'U' }
      ],
      reasoning_effort: 'low'
    })
    expect(r).toMatchObject({
      text: 'out',
      inputTokens: 11,
      outputTokens: 7,
      servedModel: 'served-model'
    })
  })

  test('groq llama has no reasoning_effort; groq gpt-oss does', async () => {
    const a = createLlmAdapter('groq', { baseUrl: `${base}/openai/v1` })
    await a.complete(ask('llama-3.3-70b-versatile'), { timeoutMs: 2000 })
    expect(last.body).not.toHaveProperty('reasoning_effort')
    await a.complete(ask('openai/gpt-oss-120b'), { timeoutMs: 2000 })
    expect(last.body).toMatchObject({ reasoning_effort: 'low' })
    expect(reasoningEffortFor('openrouter', 'gpt-5')).toBeUndefined()
    expect(reasoningEffortFor('openai', 'o3')).toBe('low')
  })

  test('openrouter sends attribution headers', async () => {
    await createLlmAdapter('openrouter', { baseUrl: `${base}/api/v1` }).complete(ask('x/y'), {
      timeoutMs: 2000
    })
    expect(last.headers['http-referer']).toBe('https://github.com/markdudov/saywrite')
    expect(last.headers['x-title']).toBe('Saywrite')
  })

  test('servedModel falls back to requested model', async () => {
    reply = { choices: [{ message: { content: 'out' } }] }
    const r = await createLlmAdapter('openai', { baseUrl: `${base}/v1` }).complete(ask('gpt-5'), {
      timeoutMs: 2000
    })
    expect(r).toMatchObject({ servedModel: 'gpt-5', inputTokens: 0, outputTokens: 0 })
  })

  test('custom-llm: empty base url fails before any call; no key sends no auth; slash trimmed', async () => {
    const empty = llmFor('custom-llm', defaultSettings('darwin'))
    await expect(empty.complete(ask('m'), { timeoutMs: 2000 })).rejects.toMatchObject({
      kind: 'bad_request',
      provider: 'custom-llm',
      message: 'Set a base URL for the custom AI provider'
    })
    await createLlmAdapter('custom-llm', { baseUrl: `${base}/v1/` }).complete(ask('m', ''), {
      timeoutMs: 2000
    })
    expect(last.path).toBe('/v1/chat/completions')
    expect(last.headers.authorization).toBeUndefined()
  })

  test('empty completion → empty', async () => {
    reply = { choices: [{ message: { content: '  ' } }] }
    await expect(
      createLlmAdapter('openai', { baseUrl: `${base}/v1` }).complete(ask('gpt-5'), {
        timeoutMs: 2000
      })
    ).rejects.toMatchObject({ kind: 'empty' })
  })
})

describe('anthropic', () => {
  test('model helpers', () => {
    expect(FALLBACK_MODELS.has('claude-opus-5-5')).toBe(true)
    expect(FALLBACK_MODELS.has('claude-haiku-5-5')).toBe(false)
    expect(supportsEffort('claude-haiku-5-5')).toBe(true)
    expect(supportsEffort('claude-opus-4-7')).toBe(true)
    expect(supportsEffort('claude-sonnet-4-6')).toBe(true)
    expect(supportsEffort('claude-opus-4-5')).toBe(false)
  })

  test('opus-5-5 uses beta fallbacks + low effort', async () => {
    const fake = fakeAnthropic({
      stop_reason: 'end_turn',
      model: 'claude-opus-5-5',
      content: [
        { type: 'thinking', thinking: '' },
        { type: 'text', text: 'hi' },
        { type: 'text', text: '!' }
      ],
      usage: { input_tokens: 5, output_tokens: 2 }
    })
    const ac = new AbortController()
    const factory = vi.fn(() => fake)
    const r = await createLlmAdapter('anthropic', { anthropicClient: factory }).complete(
      ask('claude-opus-5-5'),
      { timeoutMs: 2000, signal: ac.signal }
    )
    expect(fake.beta.messages.create).toHaveBeenCalledWith(
      {
        model: 'claude-opus-5-5',
        max_tokens: 16000,
        system: 'S',
        messages: [{ role: 'user', content: 'U' }],
        output_config: { effort: 'low' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default'
      },
      { signal: ac.signal }
    )
    expect(factory).toHaveBeenCalledWith(KEY, 2000)
    expect(fake.messages.create).not.toHaveBeenCalled()
    expect(r).toEqual({
      text: 'hi!',
      inputTokens: 5,
      outputTokens: 2,
      servedModel: 'claude-opus-5-5'
    })
  })

  test('haiku-5-5 uses messages.create without fallbacks', async () => {
    const fake = fakeAnthropic({
      stop_reason: 'end_turn',
      model: 'claude-haiku-5-5',
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 }
    })
    await createLlmAdapter('anthropic', { anthropicClient: () => fake }).complete(
      ask('claude-haiku-5-5'),
      { timeoutMs: 2000 }
    )
    expect(fake.beta.messages.create).not.toHaveBeenCalled()
    const [params] = fake.messages.create.mock.calls[0]
    expect(params).toEqual({
      model: 'claude-haiku-5-5',
      max_tokens: 16000,
      system: 'S',
      messages: [{ role: 'user', content: 'U' }],
      output_config: { effort: 'low' }
    })
    for (const k of ['temperature', 'top_p', 'top_k', 'thinking', 'fallbacks', 'betas']) {
      expect(params).not.toHaveProperty(k)
    }
  })

  test('refusal → ProviderError refusal', async () => {
    const fake = fakeAnthropic({
      stop_reason: 'refusal',
      model: 'claude-opus-5-5',
      content: [{ type: 'text', text: 'no' }],
      usage: {}
    })
    await expect(
      createLlmAdapter('anthropic', { anthropicClient: () => fake }).complete(
        ask('claude-opus-5-5'),
        {
          timeoutMs: 2000
        }
      )
    ).rejects.toMatchObject({ kind: 'refusal', provider: 'anthropic' })
  })

  test('only thinking blocks → empty', async () => {
    const fake = fakeAnthropic({
      stop_reason: 'end_turn',
      model: 'm',
      content: [{ type: 'thinking', thinking: 'hmm' }],
      usage: {}
    })
    await expect(
      createLlmAdapter('anthropic', { anthropicClient: () => fake }).complete(
        ask('claude-haiku-5-5'),
        {
          timeoutMs: 2000
        }
      )
    ).rejects.toMatchObject({ kind: 'empty' })
  })

  test('SDK errors map: APIError 401 → auth, timeout, abort, connection', async () => {
    const run = async (err: unknown): Promise<unknown> => {
      const fake = fakeAnthropic({})
      fake.messages.create.mockRejectedValue(err)
      return createLlmAdapter('anthropic', { anthropicClient: () => fake })
        .complete(ask('claude-haiku-5-5'), { timeoutMs: 2000 })
        .catch((e: unknown) => e)
    }
    const auth = Object.assign(Object.create(Anthropic.APIError.prototype), {
      status: 401,
      message: 'x'
    })
    expect(await run(auth)).toMatchObject({ kind: 'auth', status: 401, provider: 'anthropic' })
    expect(await run(new Anthropic.APIConnectionTimeoutError({}))).toMatchObject({
      kind: 'timeout'
    })
    expect(await run(new Anthropic.APIUserAbortError())).toMatchObject({
      kind: 'timeout',
      cancelled: true,
      retryable: false
    })
    expect(await run(new Anthropic.APIConnectionError({ message: 'down' }))).toMatchObject({
      kind: 'network'
    })
  })

  test('listModels uses models.list ids', async () => {
    // Real default client would hit the network, so exercise the injectable path directly.
    const { listAnthropicModels } = await import('../../src/main/providers/llm/anthropic')
    const fake = fakeAnthropic({}, ['claude-a', 'claude-b'])
    expect(await listAnthropicModels(KEY, () => fake)).toEqual(['claude-a', 'claude-b'])
  })
})

describe('gemini', () => {
  test('shape and tokens; key only in header', async () => {
    reply = {
      candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }],
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, thoughtsTokenCount: 2 }
    }
    const r = await createLlmAdapter('gemini', { baseUrl: `${base}/v1beta` }).complete(
      ask('gemini-3.8-flash'),
      { timeoutMs: 2000 }
    )
    expect(last.path).toBe('/v1beta/models/gemini-3.8-flash:generateContent')
    expect(last.headers['x-goog-api-key']).toBe(KEY)
    expect(last.rawUrl).toBe('/v1beta/models/gemini-3.8-flash:generateContent')
    expect(last.rawUrl).not.toMatch(/key=/i)
    expect(last.rawUrl).not.toContain(KEY)
    expect(last.body).toEqual({
      systemInstruction: { parts: [{ text: 'S' }] },
      contents: [{ role: 'user', parts: [{ text: 'U' }] }]
    })
    expect(r).toEqual({
      text: 'ab',
      inputTokens: 3,
      outputTokens: 6,
      servedModel: 'gemini-3.8-flash'
    })
  })

  test('model id is URL-encoded; missing thoughts count is 0; empty → empty', async () => {
    reply = {
      candidates: [{ content: { parts: [{ text: 'x' }] } }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2 }
    }
    const a = createLlmAdapter('gemini', { baseUrl: `${base}/v1beta` })
    const r = await a.complete(ask('tuned/model 1'), { timeoutMs: 2000 })
    expect(last.rawUrl).toContain('/models/tuned%2Fmodel%201:generateContent')
    expect(r.outputTokens).toBe(2)
    reply = { candidates: [{ content: { parts: [] } }] }
    await expect(a.complete(ask('gemini-3.8-flash'), { timeoutMs: 2000 })).rejects.toMatchObject({
      kind: 'empty'
    })
  })
})

describe('listModels and testKey', () => {
  test('openai-compatible lists data[].id', async () => {
    reply = { data: [{ id: 'm1' }, { id: 'm2' }] }
    expect(await listModels('llm', 'openai', KEY, `${base}/v1`)).toEqual(['m1', 'm2'])
    expect(last.path).toBe('/v1/models')
    expect(last.headers.authorization).toBe(`Bearer ${KEY}`)
  })

  test('gemini keeps generateContent models and strips prefix', async () => {
    reply = {
      models: [
        { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/embed', supportedGenerationMethods: ['embedContent'] }
      ]
    }
    expect(await listModels('llm', 'gemini', KEY, `${base}/v1beta`)).toEqual(['gemini-3.8-flash'])
    expect(last.rawUrl).toBe('/v1beta/models?pageSize=1000')
    expect(last.headers['x-goog-api-key']).toBe(KEY)
  })

  test('deepgram/elevenlabs list catalog models', async () => {
    expect(await listModels('stt', 'deepgram', KEY)).toEqual(['nova-3', 'nova-2'])
    expect(await listModels('stt', 'elevenlabs', KEY)).toEqual(['scribe_v2', 'scribe_v3'])
  })

  test('testKey ok and auth failure', async () => {
    reply = { data: [{ id: 'm1' }] }
    expect(await testKey('llm', 'openai', KEY, `${base}/v1`)).toEqual({ ok: true, models: ['m1'] })
    status = 401
    reply = { error: { message: 'bad key' } }
    expect(await testKey('llm', 'openai', 'bad', `${base}/v1`)).toMatchObject({
      ok: false,
      kind: 'auth'
    })
  })

  test('testKey deepgram and elevenlabs use their own auth endpoints', async () => {
    reply = { projects: [] }
    expect(await testKey('stt', 'deepgram', 'dk', `${base}/v1`)).toMatchObject({ ok: true })
    expect(last.path).toBe('/v1/projects')
    expect(last.headers.authorization).toBe('Token dk')
    reply = {}
    expect(await testKey('stt', 'elevenlabs', 'ek', `${base}/v1`)).toMatchObject({ ok: true })
    expect(last.path).toBe('/v1/user')
    expect(last.headers['xi-api-key']).toBe('ek')
    status = 401
    expect(await testKey('stt', 'elevenlabs', 'x', `${base}/v1`)).toMatchObject({
      ok: false,
      kind: 'auth'
    })
  })
})

describe('production default URLs and key hygiene', () => {
  afterEach(() => vi.restoreAllMocks())

  const stubFetch = (body: unknown, status = 200): Mock =>
    vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        async () => new Response(JSON.stringify(body), { status })
      ) as unknown as Mock
  const urlOf = (f: Mock): string => String(f.mock.calls[0][0])

  const chat = { choices: [{ message: { content: 'out' } }] }
  test.each([
    ['openai', 'https://api.openai.com/v1/chat/completions'],
    ['groq', 'https://api.groq.com/openai/v1/chat/completions'],
    ['openrouter', 'https://openrouter.ai/api/v1/chat/completions']
  ] as const)('%s default chat URL', async (id, url) => {
    const f = stubFetch(chat)
    await createLlmAdapter(id).complete(ask('m'), { timeoutMs: 2000 })
    expect(urlOf(f)).toBe(url)
  })

  test('gemini default URL', async () => {
    const f = stubFetch({ candidates: [{ content: { parts: [{ text: 'x' }] } }] })
    await createLlmAdapter('gemini').complete(ask('gemini-3.8-flash'), { timeoutMs: 2000 })
    expect(urlOf(f)).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent'
    )
  })

  test('key-test default URLs', async () => {
    let f = stubFetch({ data: [] })
    await testKey('llm', 'openai', KEY)
    expect(urlOf(f)).toBe('https://api.openai.com/v1/models')
    f.mockRestore()
    f = stubFetch({ models: [] })
    await testKey('llm', 'gemini', KEY)
    expect(urlOf(f)).toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000')
    f.mockRestore()
    f = stubFetch({})
    await testKey('stt', 'deepgram', KEY)
    expect(urlOf(f)).toBe('https://api.deepgram.com/v1/projects')
    f.mockRestore()
    f = stubFetch({})
    await testKey('stt', 'elevenlabs', KEY)
    expect(urlOf(f)).toBe('https://api.elevenlabs.io/v1/user')
  })

  test('401 error message never contains the key', async () => {
    stubFetch({ error: { message: 'Incorrect API key provided' } }, 401)
    const e = await createLlmAdapter('openai')
      .complete(ask('m'), { timeoutMs: 2000 })
      .catch((x: unknown) => x)
    expect(e).toMatchObject({ kind: 'auth' })
    expect((e as Error).message).not.toContain(KEY)
    const r = await testKey('llm', 'openai', KEY)
    expect(JSON.stringify(r)).not.toContain(KEY)
  })
})

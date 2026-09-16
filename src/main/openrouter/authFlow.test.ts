import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as http from 'http'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../db/testDb'
import type * as schema from '../db/schema'
import { __resetElectronMock, __setEncryptionAvailable } from '../../../test/mocks/electron'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../db/index', () => ({ getDb: () => testDb }))

vi.mock('./keyStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./keyStore')>()
  return { ...actual, storeOpenRouterKey: vi.fn(actual.storeOpenRouterKey) }
})

import { startAuth, submitAuthCode, cancelAuth, getAuthStatus, __resetAuthFlowForTests } from './authFlow'
import { readOpenRouterKey } from './keyStore'
import { storeOpenRouterKey } from './keyStore'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function fetchExchangingKey(key: string): typeof fetch {
  return vi.fn().mockResolvedValue(jsonResponse(200, { key })) as unknown as typeof fetch
}

/** GETs a path on the loopback server started by `startAuth`, resolving with the status code and body. */
function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
      })
      .on('error', reject)
  })
}

function callbackUrlFromAuthUrl(authUrl: string): string {
  const url = new URL(authUrl)
  const callback = url.searchParams.get('callback_url')
  if (!callback) throw new Error('authUrl had no callback_url')
  return callback
}

beforeEach(() => {
  __resetElectronMock()
  testDb = createTestDb().db
  __resetAuthFlowForTests()
  vi.mocked(storeOpenRouterKey).mockClear()
})

afterEach(() => {
  __resetAuthFlowForTests()
  vi.useRealTimers()
})

describe('startAuth', () => {
  it('starts waiting, builds a valid PKCE auth URL, and opens it externally', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined)
    const result = await startAuth({}, { fetch: fetchExchangingKey('sk-x'), openExternal })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const url = new URL(result.authUrl)
    expect(url.origin + url.pathname).toBe('https://openrouter.ai/auth')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBeTruthy()
    expect(url.searchParams.get('callback_url')).toMatch(/^http:\/\/localhost:\d+\/callback$/)

    expect(openExternal).toHaveBeenCalledWith(result.authUrl)
    expect(getAuthStatus()).toMatchObject({ state: 'waiting', authUrl: result.authUrl })
  })

  it('refuses a second call while one is already waiting', async () => {
    await startAuth({}, { fetch: fetchExchangingKey('sk-x'), openExternal: vi.fn().mockResolvedValue(undefined) })
    const second = await startAuth({}, { fetch: fetchExchangingKey('sk-x'), openExternal: vi.fn().mockResolvedValue(undefined) })
    expect(second).toEqual({ ok: false, error: { code: 'openrouterAuthInProgress' } })
  })

  it('refuses an overlapping call made before the first has finished starting its server', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined)
    const [first, second] = await Promise.all([
      startAuth({}, { fetch: fetchExchangingKey('sk-x'), openExternal }),
      startAuth({}, { fetch: fetchExchangingKey('sk-x'), openExternal })
    ])
    expect(first.ok).toBe(true)
    expect(second).toEqual({ ok: false, error: { code: 'openrouterAuthInProgress' } })
    // Exactly one browser hand-off, for the one flow that is now waiting.
    expect(openExternal).toHaveBeenCalledTimes(1)
    if (!first.ok) return
    expect(getAuthStatus()).toMatchObject({ state: 'waiting', authUrl: first.authUrl })
  })

  it('releases the lock when starting fails, so a retry is allowed', async () => {
    __setEncryptionAvailable(false)
    const failed = await startAuth({}, { openExternal: vi.fn().mockResolvedValue(undefined) })
    expect(failed.ok).toBe(false)
    __setEncryptionAvailable(true)
    const retried = await startAuth({}, { openExternal: vi.fn().mockResolvedValue(undefined) })
    expect(retried.ok).toBe(true)
  })

  it('refuses when there is no keychain and plaintext was not explicitly allowed', async () => {
    __setEncryptionAvailable(false)
    const result = await startAuth({}, { openExternal: vi.fn().mockResolvedValue(undefined) })
    expect(result).toEqual({ ok: false, error: { code: 'openrouterKeychainUnavailable' } })
  })

  it('proceeds when there is no keychain but plaintext is explicitly allowed', async () => {
    __setEncryptionAvailable(false)
    const result = await startAuth({ allowPlaintextKey: true }, { openExternal: vi.fn().mockResolvedValue(undefined) })
    expect(result.ok).toBe(true)
  })

  it('is not fatal when openExternal rejects: it still returns ok with the URL for the UI to show', async () => {
    const openExternal = vi.fn().mockRejectedValue(new Error('no default browser'))
    const result = await startAuth({}, { openExternal })
    expect(result.ok).toBe(true)
  })
})

describe('the loopback callback server', () => {
  it('accepts GET /callback?code=... , responds 200, and exchanges the code end to end', async () => {
    const started = await startAuth({}, { fetch: fetchExchangingKey('sk-or-v1-final') })
    if (!started.ok) throw new Error('startAuth failed')

    const callbackUrl = callbackUrlFromAuthUrl(started.authUrl)
    const response = await httpGet(`${callbackUrl}?code=the-code`)
    expect(response.status).toBe(200)
    expect(response.body).toContain('Authorization complete')

    // The exchange runs after the HTTP response is sent, not before;
    // poll briefly for the status transition rather than assuming it is
    // already done.
    await vi.waitFor(() => expect(getAuthStatus()).toEqual({ state: 'connected' }))
    expect(readOpenRouterKey()).toEqual({ key: 'sk-or-v1-final', storedPlaintext: false })
  })

  it('responds 400 and leaves the flow waiting when the callback has no code', async () => {
    const started = await startAuth({}, { fetch: fetchExchangingKey('sk-x') })
    if (!started.ok) throw new Error('startAuth failed')

    const callbackUrl = callbackUrlFromAuthUrl(started.authUrl)
    const response = await httpGet(callbackUrl)
    expect(response.status).toBe(400)
    expect(getAuthStatus().state).toBe('waiting')
  })

  it('responds 404 for any other path', async () => {
    const started = await startAuth({}, { fetch: fetchExchangingKey('sk-x') })
    if (!started.ok) throw new Error('startAuth failed')

    const url = new URL(callbackUrlFromAuthUrl(started.authUrl))
    const response = await httpGet(`http://localhost:${url.port}/nope`)
    expect(response.status).toBe(404)
  })

  it('guards against the callback arriving twice: only one key exchange happens', async () => {
    const fetchImpl = fetchExchangingKey('sk-once')
    const started = await startAuth({}, { fetch: fetchImpl })
    if (!started.ok) throw new Error('startAuth failed')

    const callbackUrl = callbackUrlFromAuthUrl(started.authUrl)
    await httpGet(`${callbackUrl}?code=the-code`)
    await vi.waitFor(() => expect(getAuthStatus()).toEqual({ state: 'connected' }))

    // A second hit lands on a server that has since been closed; either it
    // fails to connect or (if the close hadn't landed yet) it would still
    // never re-trigger a second exchange, since `codeHandled` is set.
    await httpGet(`${callbackUrl}?code=the-code`).catch(() => undefined)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('submitAuthCode', () => {
  it('accepts a bare code while waiting and connects', async () => {
    const started = await startAuth({}, { fetch: fetchExchangingKey('sk-pasted') })
    if (!started.ok) throw new Error('startAuth failed')

    const result = await submitAuthCode('a-pasted-code')
    expect(result).toEqual({ ok: true })
    expect(readOpenRouterKey()?.key).toBe('sk-pasted')
  })

  it('extracts the code from a full callback URL', async () => {
    const started = await startAuth({}, { fetch: fetchExchangingKey('sk-pasted-url') })
    if (!started.ok) throw new Error('startAuth failed')

    const result = await submitAuthCode(`${callbackUrlFromAuthUrl(started.authUrl)}?code=abc123&state=xyz`)
    expect(result).toEqual({ ok: true })
    expect(readOpenRouterKey()?.key).toBe('sk-pasted-url')
  })

  it('rejects an empty or whitespace-only input', async () => {
    await startAuth({}, { fetch: fetchExchangingKey('sk-x') })
    expect(await submitAuthCode('')).toEqual({ ok: false, error: { code: 'openrouterInvalidCode' } })
    expect(await submitAuthCode('   ')).toEqual({ ok: false, error: { code: 'openrouterInvalidCode' } })
  })

  it('rejects a URL with no code param', async () => {
    await startAuth({}, { fetch: fetchExchangingKey('sk-x') })
    expect(await submitAuthCode('http://localhost:1234/callback')).toEqual({
      ok: false,
      error: { code: 'openrouterInvalidCode' }
    })
  })

  it('refuses when no flow is waiting', async () => {
    expect(await submitAuthCode('some-code')).toEqual({ ok: false, error: { code: 'openrouterAuthNotWaiting' } })
  })

  it('propagates a mapped error from a failed exchange and marks the flow failed', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 })) as unknown as typeof fetch
    await startAuth({}, { fetch: fetchImpl })
    const result = await submitAuthCode('bad-code')
    const error = { code: 'openrouterAuthFailed', params: { message: 'OpenRouter rejected the authorization code.' } }
    expect(result).toEqual({ ok: false, error })
    expect(getAuthStatus()).toEqual({ state: 'failed', error })
  })

  it('marks the flow failed with openrouterKeychainUnavailable when storing the key throws', async () => {
    vi.mocked(storeOpenRouterKey).mockImplementationOnce(() => {
      throw new Error('keychain locked')
    })
    await startAuth({}, { fetch: fetchExchangingKey('sk-x') })
    const result = await submitAuthCode('some-code')
    expect(result).toEqual({ ok: false, error: { code: 'openrouterKeychainUnavailable' } })
  })
})

describe('cancelAuth', () => {
  it('returns the flow to idle from waiting, and a new startAuth is then allowed', async () => {
    await startAuth({}, { fetch: fetchExchangingKey('sk-x') })
    expect(cancelAuth()).toEqual({ ok: true })
    expect(getAuthStatus()).toEqual({ state: 'idle' })

    const second = await startAuth({}, { fetch: fetchExchangingKey('sk-y') })
    expect(second.ok).toBe(true)
  })

  it('is a harmless no-op when nothing is in flight', () => {
    expect(cancelAuth()).toEqual({ ok: true })
    expect(getAuthStatus()).toEqual({ state: 'idle' })
  })
})

describe('startAuth timeout', () => {
  it('fails the flow after 10 minutes of no callback', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await startAuth({}, { fetch: fetchExchangingKey('sk-x'), openExternal: vi.fn().mockResolvedValue(undefined) })
    expect(getAuthStatus().state).toBe('waiting')

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1)

    expect(getAuthStatus().state).toBe('failed')
  })
})

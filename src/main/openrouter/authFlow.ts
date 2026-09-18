import * as http from 'http'
import type { AddressInfo } from 'net'
import { shell } from 'electron'
import { appError, type AppError } from '@shared/types/errorCodes'
import type { OpenRouterAuthStatus, StartOpenRouterAuthOptions } from '@shared/types/openrouter'
import { isEncryptionAvailable } from '../db/encryption'
import { appLogger } from '../logger'
import { createPkcePair } from './pkce'
import { exchangeAuthCode, type FetchLike } from './api'
import { storeOpenRouterKey } from './keyStore'
import { broadcastOpenRouterAuthStatus } from './broadcast'

/**
 * "Connect with OpenRouter", Claude-Code-device-flow style: main opens the
 * user's own browser to OpenRouter's consent screen, and gets the resulting
 * authorization code back over a loopback HTTP server it starts just for
 * this: no redirect URI to register anywhere, since OpenRouter allows any
 * localhost callback. A pasted code/URL (`submitAuthCode`) is kept as a
 * fallback for a firewall or a browser that opens somewhere unexpected,
 * both routes funnelling into the same `exchange` so the "already handled"
 * guard only has to live in one place.
 *
 * Only one flow is ever in flight (module-level state, not per-window;
 * there is exactly one OpenRouter account to connect). `startAuth`,
 * `submitAuthCode` and `cancelAuth` all resolve immediately; long-running
 * progress is pushed through `broadcast.ts` as `OpenRouterAuthStatus`
 * transitions (`waiting` -> `exchanging` -> `connected`/`failed`), which is
 * also how the renderer notices a code arriving at the loopback server
 * without it having called anything.
 */

const OPENROUTER_AUTH_URL = 'https://openrouter.ai/auth'
const AUTH_TIMEOUT_MS = 10 * 60 * 1000
const MAX_PASTED_INPUT_LENGTH = 4096

const SUCCESS_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Applyer</title></head>
<body style="font-family: system-ui, sans-serif; padding: 48px; text-align: center; color: #1a1d23;">
<h1>Authorization complete</h1>
<p>You can close this tab and return to Applyer.</p>
</body>
</html>`

const MISSING_CODE_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Applyer</title></head>
<body style="font-family: system-ui, sans-serif; padding: 48px; text-align: center; color: #1a1d23;">
<h1>Authorization incomplete</h1>
<p>No authorization code was received. Close this tab and try again from Applyer.</p>
</body>
</html>`

const NOT_FOUND_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Not found</title></head>
<body style="font-family: system-ui, sans-serif; padding: 48px; text-align: center; color: #1a1d23;">
<h1>Not found</h1>
</body>
</html>`

interface AuthFlowDeps {
  fetch?: FetchLike
  openExternal?: (url: string) => Promise<void>
}

interface AuthFlowState {
  status: OpenRouterAuthStatus
  server: http.Server | null
  verifier: string | null
  allowPlaintext: boolean
  codeHandled: boolean
  timeoutHandle: ReturnType<typeof setTimeout> | null
  fetchImpl: FetchLike
}

function initialState(): AuthFlowState {
  return {
    status: { state: 'idle' },
    server: null,
    verifier: null,
    allowPlaintext: false,
    codeHandled: false,
    timeoutHandle: null,
    fetchImpl: fetch
  }
}

let state: AuthFlowState = initialState()
/**
 * Held from `startAuth`'s entry until its state is written. The status
 * only turns `waiting` after the loopback server is listening, so without
 * this two clicks in quick succession both pass the status guard, both
 * start a server, and the second overwrites the first's verifier: the
 * browser tab the first opened then exchanges its code against the wrong
 * verifier, and the first server is orphaned.
 */
let starting = false

function setStatus(status: OpenRouterAuthStatus): void {
  state.status = status
  broadcastOpenRouterAuthStatus(status)
}

function clearTimeoutHandle(): void {
  if (state.timeoutHandle) {
    clearTimeout(state.timeoutHandle)
    state.timeoutHandle = null
  }
}

function closeServer(): void {
  if (state.server) {
    state.server.close()
    state.server = null
  }
  state.verifier = null
}

function startLoopbackServer(onCode: (code: string) => void): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (url.pathname !== '/callback') {
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(NOT_FOUND_HTML)
          return
        }
        const code = url.searchParams.get('code')
        if (!code || code.trim().length === 0) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(MISSING_CODE_HTML)
          return
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(SUCCESS_HTML)
        onCode(code.trim())
      } catch (err) {
        appLogger.error(`OpenRouter auth callback handling failed: ${err instanceof Error ? err.message : String(err)}`)
        try {
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end('<!doctype html><html lang="en"><title>Error</title><body>Something went wrong.</body></html>')
        } catch {
          // Response may already be partially sent; nothing more to do.
        }
      }
    })
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo | string | null
      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('Could not determine the callback server port.'))
        return
      }
      resolve({ server, port: address.port })
    })
  })
}

/**
 * Both the loopback callback and a pasted code funnel through here. Guarded
 * against running twice (`codeHandled`) since the callback route can, in
 * principle, be hit more than once (a doubled browser tab, a retry by an
 * impatient user), and a second `/api/v1/auth/keys` exchange for the same
 * code would just fail upstream anyway.
 */
async function exchange(code: string): Promise<{ ok: true } | { ok: false; error: AppError }> {
  if (state.codeHandled) {
    return { ok: true }
  }
  state.codeHandled = true
  clearTimeoutHandle()

  const verifier = state.verifier
  if (!verifier) {
    const error = appError('openrouterAuthFailed', { message: 'The authorization flow lost its PKCE verifier; start over.' })
    closeServer()
    setStatus({ state: 'failed', error })
    return { ok: false, error }
  }

  setStatus({ state: 'exchanging' })

  const exchanged = await exchangeAuthCode({ code, verifier }, state.fetchImpl)
  if (!exchanged.ok) {
    closeServer()
    setStatus({ state: 'failed', error: exchanged.error })
    return { ok: false, error: exchanged.error }
  }

  try {
    storeOpenRouterKey(exchanged.value.key, { allowPlaintext: state.allowPlaintext })
  } catch (err) {
    appLogger.error(`OpenRouter auth: could not store the API key: ${err instanceof Error ? err.message : String(err)}`)
    const error = appError('openrouterKeychainUnavailable')
    closeServer()
    setStatus({ state: 'failed', error })
    return { ok: false, error }
  }

  closeServer()
  setStatus({ state: 'connected' })
  return { ok: true }
}

export async function startAuth(
  options: StartOpenRouterAuthOptions = {},
  deps: AuthFlowDeps = {}
): Promise<{ ok: true; authUrl: string } | { ok: false; error: AppError }> {
  if (starting || state.status.state === 'waiting' || state.status.state === 'exchanging') {
    return { ok: false, error: appError('openrouterAuthInProgress') }
  }
  starting = true
  try {
    return await startAuthLocked(options, deps)
  } finally {
    starting = false
  }
}

async function startAuthLocked(
  options: StartOpenRouterAuthOptions,
  deps: AuthFlowDeps
): Promise<{ ok: true; authUrl: string } | { ok: false; error: AppError }> {
  const allowPlaintext = options.allowPlaintextKey === true
  if (!isEncryptionAvailable() && !allowPlaintext) {
    return { ok: false, error: appError('openrouterKeychainUnavailable') }
  }

  const { verifier, challenge } = createPkcePair()

  let server: http.Server
  let port: number
  try {
    const started = await startLoopbackServer((code) => {
      void exchange(code)
    })
    server = started.server
    port = started.port
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    appLogger.error(`OpenRouter auth: could not start the local callback server: ${message}`)
    return { ok: false, error: appError('openrouterAuthFailed', { message }) }
  }

  const callbackUrl = `http://localhost:${port}/callback`
  const authUrl = `${OPENROUTER_AUTH_URL}?callback_url=${encodeURIComponent(callbackUrl)}&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=S256`

  state = {
    status: { state: 'waiting', authUrl, startedAt: new Date().toISOString() },
    server,
    verifier,
    allowPlaintext,
    codeHandled: false,
    timeoutHandle: null,
    fetchImpl: deps.fetch ?? fetch
  }
  state.timeoutHandle = setTimeout(() => {
    if (state.status.state === 'waiting') {
      closeServer()
      setStatus({ state: 'failed', error: appError('openrouterAuthFailed', { message: 'Timed out waiting for authorization.' }) })
    }
  }, AUTH_TIMEOUT_MS)

  const openExternal = deps.openExternal ?? ((url: string) => shell.openExternal(url))
  try {
    await openExternal(authUrl)
  } catch (err) {
    // Not fatal: the URL is shown in the UI so the user can open it
    // themselves (a remote/headless machine, a browser that refuses the
    // handoff, a sandboxed environment with no default browser at all).
    appLogger.warn(`OpenRouter auth: could not open the browser automatically: ${err instanceof Error ? err.message : String(err)}`)
  }

  broadcastOpenRouterAuthStatus(state.status)
  return { ok: true, authUrl }
}

function extractCode(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_PASTED_INPUT_LENGTH) return null
  try {
    const url = new URL(trimmed)
    const fromUrl = url.searchParams.get('code')
    return fromUrl && fromUrl.trim().length > 0 ? fromUrl.trim() : null
  } catch {
    // Not a URL: a bare code should never contain whitespace; anything
    // that does is more likely a partial paste than a real code.
    return /\s/.test(trimmed) ? null : trimmed
  }
}

export async function submitAuthCode(codeOrUrl: string): Promise<{ ok: true } | { ok: false; error: AppError }> {
  if (state.status.state !== 'waiting') {
    return { ok: false, error: appError('openrouterAuthNotWaiting') }
  }
  const code = extractCode(codeOrUrl)
  if (!code) {
    return { ok: false, error: appError('openrouterInvalidCode') }
  }
  return exchange(code)
}

export function cancelAuth(): { ok: boolean } {
  if (state.status.state === 'waiting' || state.status.state === 'exchanging') {
    clearTimeoutHandle()
    closeServer()
    setStatus({ state: 'idle' })
  }
  return { ok: true }
}

export function getAuthStatus(): OpenRouterAuthStatus {
  return state.status
}

/** Test-only: resets the single in-flight-flow state between tests. */
export function __resetAuthFlowForTests(): void {
  clearTimeoutHandle()
  closeServer()
  state = initialState()
  starting = false
}

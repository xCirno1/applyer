import { ipcMain } from 'electron'
import { IPC } from '@shared/types/ipcEvents'
import { appError, unexpectedError, type AppError } from '@shared/types/errorCodes'
import { isAgentMode, type AgentMode } from '@shared/types/agentMode'
import {
  isOpenRouterSettings,
  normalizeToolApproval,
  type OpenRouterConnection,
  type OpenRouterCredits,
  type OpenRouterKeyInfo,
  type OpenRouterSettings,
  type StartOpenRouterAuthOptions
} from '@shared/types/openrouter'
import { getAgentMode, getOpenRouterSettings, setAgentMode, setOpenRouterSettings } from '../db/repositories/settingsRepository'
import { isEncryptionAvailable } from '../db/encryption'
import { clearOpenRouterKey, readOpenRouterKey } from '../openrouter/keyStore'
import { fetchCredits, fetchKeyInfo } from '../openrouter/api'
import { getModelCatalog } from '../openrouter/modelCatalog'
import { cancelAuth, startAuth, submitAuthCode } from '../openrouter/authFlow'
import { broadcastAgentModeChanged } from '../openrouter/broadcast'
import { logActivity } from '../db/repositories/activityLogRepository'
import { appLogger } from '../logger'

/**
 * Every `IPC.openrouter.*` channel, plus the two `IPC.settings` channels for
 * agent mode (cli vs openrouter): grouped here rather than in
 * `ipc/settings.ts` because agent mode is really OpenRouter mode's on/off
 * switch, and every other handler on this channel already needs the same
 * imports (`authFlow`, `keyStore`, `broadcast.ts`).
 *
 * `getConnection`/`refreshConnection` are the one place here doing real
 * work beyond a straight repository call: connecting is a stored key, but
 * *displaying* the connection (label, credit usage, remaining balance)
 * means two live OpenRouter requests every time Settings renders. Those are
 * cached for a minute so switching to Settings and back doesn't refetch on
 * every mount; `refreshConnection` (the explicit "Refresh" button) always
 * bypasses that cache.
 */

const CONNECTION_CACHE_TTL_MS = 60_000

interface ConnectionCache {
  /** The key this cache was built for; a changed key (reconnect, disconnect+reconnect) invalidates it even inside the TTL. */
  key: string
  keyInfo: OpenRouterKeyInfo | null
  credits: OpenRouterCredits | null
  refreshError: AppError | null
  keyRejected: boolean
  fetchedAt: number
}

let connectionCache: ConnectionCache | null = null

/**
 * Drops the cached connection so the next `getConnection` asks OpenRouter
 * again. `agentRunner.ts` calls this when a chat turn's request comes back
 * 401: the cache may still say the key is fine for up to a minute, and the
 * chat panel re-reads the connection on that failure to show Reconnect.
 */
export function invalidateOpenRouterConnectionCache(): void {
  connectionCache = null
}

async function buildConnection(forceRefresh: boolean): Promise<OpenRouterConnection> {
  const stored = readOpenRouterKey()
  const keychainAvailable = isEncryptionAvailable()

  if (!stored) {
    connectionCache = null
    return { connected: false, keychainAvailable }
  }

  const now = Date.now()
  if (
    !forceRefresh &&
    connectionCache &&
    connectionCache.key === stored.key &&
    now - connectionCache.fetchedAt < CONNECTION_CACHE_TTL_MS
  ) {
    return {
      connected: true,
      keychainAvailable,
      storedPlaintext: stored.storedPlaintext,
      keyInfo: connectionCache.keyInfo,
      credits: connectionCache.credits,
      refreshError: connectionCache.refreshError,
      keyRejected: connectionCache.keyRejected
    }
  }

  const [keyInfoResult, creditsResult] = await Promise.all([fetchKeyInfo(stored.key), fetchCredits(stored.key)])
  if (!keyInfoResult.ok) appLogger.warn(`OpenRouter key info refresh failed: ${keyInfoResult.error.code}`)
  if (!creditsResult.ok) appLogger.warn(`OpenRouter credits refresh failed: ${creditsResult.error.code}`)

  const keyInfo = keyInfoResult.ok ? keyInfoResult.value : null
  const credits = creditsResult.ok ? creditsResult.value : null
  const refreshError = !keyInfoResult.ok ? keyInfoResult.error : !creditsResult.ok ? creditsResult.error : null
  const keyRejected = refreshError?.code === 'openrouterKeyRejected'
  if (keyRejected) logActivity('warn', 'OpenRouter rejected the stored key; reconnect from Settings > Agent')

  connectionCache = { key: stored.key, keyInfo, credits, refreshError, keyRejected, fetchedAt: now }

  return { connected: true, keychainAvailable, storedPlaintext: stored.storedPlaintext, keyInfo, credits, refreshError, keyRejected }
}

function parseStartAuthOptions(payload: unknown): StartOpenRouterAuthOptions {
  if (typeof payload !== 'object' || payload === null) return {}
  const allowPlaintextKey = (payload as { allowPlaintextKey?: unknown }).allowPlaintextKey
  return typeof allowPlaintextKey === 'boolean' ? { allowPlaintextKey } : {}
}

export function registerOpenRouterIpc(): void {
  ipcMain.handle(IPC.openrouter.getConnection, async (): Promise<OpenRouterConnection> => buildConnection(false))

  ipcMain.handle(IPC.openrouter.refreshConnection, async (): Promise<OpenRouterConnection> => buildConnection(true))

  ipcMain.handle(IPC.openrouter.startAuth, async (_event, payload: unknown) => {
    const result = await startAuth(parseStartAuthOptions(payload))
    logActivity(result.ok ? 'info' : 'warn', result.ok ? 'OpenRouter connection started' : 'OpenRouter connection could not start', {
      ...(result.ok ? {} : { error: result.error.code })
    })
    return result
  })

  ipcMain.handle(IPC.openrouter.cancelAuth, (): { ok: boolean } => {
    const result = cancelAuth()
    return result
  })

  ipcMain.handle(IPC.openrouter.submitAuthCode, async (_event, payload: unknown) => {
    const codeOrUrl = typeof payload === 'object' && payload !== null ? (payload as { codeOrUrl?: unknown }).codeOrUrl : undefined
    if (typeof codeOrUrl !== 'string') {
      return { ok: false, error: appError('openrouterInvalidCode') }
    }
    const result = await submitAuthCode(codeOrUrl)
    if (result.ok) {
      connectionCache = null
      logActivity('info', 'OpenRouter connected')
    }
    return result
  })

  ipcMain.handle(IPC.openrouter.disconnect, (): { ok: true } | { ok: false; error: AppError } => {
    try {
      cancelAuth()
      clearOpenRouterKey()
      connectionCache = null
      logActivity('info', 'OpenRouter disconnected')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: unexpectedError(err) }
    }
  })

  ipcMain.handle(IPC.openrouter.listModels, async (_event, payload: unknown) => {
    const refresh = typeof payload === 'object' && payload !== null && (payload as { refresh?: unknown }).refresh === true
    return getModelCatalog({ refresh })
  })

  ipcMain.handle(IPC.openrouter.getSettings, (): OpenRouterSettings => getOpenRouterSettings())

  ipcMain.handle(IPC.openrouter.setSettings, (_event, payload: unknown) => {
    if (!isOpenRouterSettings(payload)) {
      return { ok: false, error: appError('invalidOpenRouterSettings') }
    }
    try {
      const settings: OpenRouterSettings = {
        modelId: payload.modelId,
        reasoningEffort: payload.reasoningEffort,
        toolApproval: normalizeToolApproval(payload.toolApproval)
      }
      setOpenRouterSettings(settings)
      logActivity('info', 'OpenRouter settings updated')
      return { ok: true, settings }
    } catch (err) {
      return { ok: false, error: unexpectedError(err) }
    }
  })

  ipcMain.handle(IPC.settings.getAgentMode, (): AgentMode => getAgentMode())

  ipcMain.handle(IPC.settings.setAgentMode, (_event, payload: unknown) => {
    const mode = typeof payload === 'object' && payload !== null ? (payload as { mode?: unknown }).mode : undefined
    if (!isAgentMode(mode)) {
      return { ok: false, error: appError('invalidAgentMode') }
    }
    try {
      setAgentMode(mode)
      broadcastAgentModeChanged(mode)
      logActivity('info', `Agent mode set to ${mode}`)
      return { ok: true, mode }
    } catch (err) {
      return { ok: false, error: unexpectedError(err) }
    }
  })
}

/** Test-only: clears the connection cache between tests. */
export function __resetOpenRouterIpcCacheForTests(): void {
  connectionCache = null
}

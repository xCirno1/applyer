import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IPC } from '@shared/types/ipcEvents'
import { __invokeIpc, __resetIpcMock } from '../../../test/mocks/electron'

const startAuth = vi.fn()
const cancelAuth = vi.fn()
const submitAuthCode = vi.fn()
vi.mock('../openrouter/authFlow', () => ({
  startAuth: (...args: unknown[]) => startAuth(...args),
  cancelAuth: (...args: unknown[]) => cancelAuth(...args),
  submitAuthCode: (...args: unknown[]) => submitAuthCode(...args),
  getAuthStatus: () => ({ state: 'idle' })
}))

const readOpenRouterKey = vi.fn()
const clearOpenRouterKey = vi.fn()
vi.mock('../openrouter/keyStore', () => ({
  readOpenRouterKey: (...args: unknown[]) => readOpenRouterKey(...args),
  clearOpenRouterKey: (...args: unknown[]) => clearOpenRouterKey(...args)
}))

const fetchKeyInfo = vi.fn()
const fetchCredits = vi.fn()
vi.mock('../openrouter/api', () => ({
  fetchKeyInfo: (...args: unknown[]) => fetchKeyInfo(...args),
  fetchCredits: (...args: unknown[]) => fetchCredits(...args)
}))

const getModelCatalog = vi.fn()
vi.mock('../openrouter/modelCatalog', () => ({
  getModelCatalog: (...args: unknown[]) => getModelCatalog(...args)
}))

const broadcastAgentModeChanged = vi.fn()
vi.mock('../openrouter/broadcast', () => ({
  broadcastAgentModeChanged: (...args: unknown[]) => broadcastAgentModeChanged(...args)
}))

const isEncryptionAvailable = vi.fn()
vi.mock('../db/encryption', () => ({
  isEncryptionAvailable: (...args: unknown[]) => isEncryptionAvailable(...args)
}))

const getAgentMode = vi.fn()
const setAgentMode = vi.fn()
const getOpenRouterSettings = vi.fn()
const setOpenRouterSettings = vi.fn()
vi.mock('../db/repositories/settingsRepository', () => ({
  getAgentMode: (...args: unknown[]) => getAgentMode(...args),
  setAgentMode: (...args: unknown[]) => setAgentMode(...args),
  getOpenRouterSettings: (...args: unknown[]) => getOpenRouterSettings(...args),
  setOpenRouterSettings: (...args: unknown[]) => setOpenRouterSettings(...args)
}))

const logActivity = vi.fn()
vi.mock('../db/repositories/activityLogRepository', () => ({
  logActivity: (...args: unknown[]) => logActivity(...args)
}))

import { registerOpenRouterIpc, __resetOpenRouterIpcCacheForTests, invalidateOpenRouterConnectionCache } from './openrouter'

beforeEach(() => {
  __resetIpcMock()
  __resetOpenRouterIpcCacheForTests()
  for (const mockFn of [
    startAuth,
    cancelAuth,
    submitAuthCode,
    readOpenRouterKey,
    clearOpenRouterKey,
    fetchKeyInfo,
    fetchCredits,
    getModelCatalog,
    broadcastAgentModeChanged,
    isEncryptionAvailable,
    getAgentMode,
    setAgentMode,
    getOpenRouterSettings,
    setOpenRouterSettings,
    logActivity
  ]) {
    mockFn.mockReset()
  }
  isEncryptionAvailable.mockReturnValue(true)
  registerOpenRouterIpc()
})

describe('getConnection', () => {
  it('reports not connected with no stored key', async () => {
    readOpenRouterKey.mockReturnValue(null)
    const result = await __invokeIpc(IPC.openrouter.getConnection)
    expect(result).toEqual({ connected: false, keychainAvailable: true })
    expect(fetchKeyInfo).not.toHaveBeenCalled()
  })

  it('fetches key info and credits in parallel when a key is stored', async () => {
    readOpenRouterKey.mockReturnValue({ key: 'sk-x', storedPlaintext: false })
    fetchKeyInfo.mockResolvedValue({ ok: true, value: { label: 'k', limit: null, usage: 0, isFreeTier: false, keyHash: 'h' } })
    fetchCredits.mockResolvedValue({ ok: true, value: { totalCredits: 10, totalUsage: 1 } })

    const result = await __invokeIpc(IPC.openrouter.getConnection)
    expect(result).toEqual({
      connected: true,
      keychainAvailable: true,
      storedPlaintext: false,
      keyInfo: { label: 'k', limit: null, usage: 0, isFreeTier: false, keyHash: 'h' },
      credits: { totalCredits: 10, totalUsage: 1 },
      refreshError: null,
      keyRejected: false
    })
  })

  it('reports a key OpenRouter answers 401 to as rejected, still connected so it can be disconnected or replaced', async () => {
    readOpenRouterKey.mockReturnValue({ key: 'sk-x', storedPlaintext: false })
    fetchKeyInfo.mockResolvedValue({ ok: false, error: { code: 'openrouterKeyRejected' } })
    fetchCredits.mockResolvedValue({ ok: false, error: { code: 'openrouterKeyRejected' } })

    const result = await __invokeIpc(IPC.openrouter.getConnection)
    expect(result).toMatchObject({ connected: true, keyInfo: null, credits: null, keyRejected: true, refreshError: { code: 'openrouterKeyRejected' } })
  })

  it('invalidateOpenRouterConnectionCache makes the next getConnection ask again inside the TTL', async () => {
    readOpenRouterKey.mockReturnValue({ key: 'sk-x', storedPlaintext: false })
    fetchKeyInfo.mockResolvedValue({ ok: true, value: { label: 'k', limit: null, usage: 0, isFreeTier: false, keyHash: 'h' } })
    fetchCredits.mockResolvedValue({ ok: true, value: { totalCredits: 10, totalUsage: 1 } })
    await __invokeIpc(IPC.openrouter.getConnection)
    fetchKeyInfo.mockResolvedValue({ ok: false, error: { code: 'openrouterKeyRejected' } })
    fetchCredits.mockResolvedValue({ ok: false, error: { code: 'openrouterKeyRejected' } })

    expect(await __invokeIpc(IPC.openrouter.getConnection)).toMatchObject({ keyRejected: false })
    invalidateOpenRouterConnectionCache()
    expect(await __invokeIpc(IPC.openrouter.getConnection)).toMatchObject({ keyRejected: true })
  })

  it('tolerates one of the two requests failing, reporting refreshError and a null field', async () => {
    readOpenRouterKey.mockReturnValue({ key: 'sk-x', storedPlaintext: false })
    fetchKeyInfo.mockResolvedValue({ ok: false, error: { code: 'openrouterRateLimited' } })
    fetchCredits.mockResolvedValue({ ok: true, value: { totalCredits: 10, totalUsage: 1 } })

    const result = await __invokeIpc(IPC.openrouter.getConnection)
    expect(result).toMatchObject({
      connected: true,
      keyInfo: null,
      credits: { totalCredits: 10, totalUsage: 1 },
      refreshError: { code: 'openrouterRateLimited' }
    })
  })

  it('caches a good result for subsequent getConnection calls with the same key', async () => {
    readOpenRouterKey.mockReturnValue({ key: 'sk-x', storedPlaintext: false })
    fetchKeyInfo.mockResolvedValue({ ok: true, value: { label: null, limit: null, usage: 0, isFreeTier: false, keyHash: 'h' } })
    fetchCredits.mockResolvedValue({ ok: true, value: { totalCredits: 1, totalUsage: 0 } })

    await __invokeIpc(IPC.openrouter.getConnection)
    await __invokeIpc(IPC.openrouter.getConnection)
    expect(fetchKeyInfo).toHaveBeenCalledTimes(1)
    expect(fetchCredits).toHaveBeenCalledTimes(1)
  })

  it('refreshConnection always bypasses the cache', async () => {
    readOpenRouterKey.mockReturnValue({ key: 'sk-x', storedPlaintext: false })
    fetchKeyInfo.mockResolvedValue({ ok: true, value: { label: null, limit: null, usage: 0, isFreeTier: false, keyHash: 'h' } })
    fetchCredits.mockResolvedValue({ ok: true, value: { totalCredits: 1, totalUsage: 0 } })

    await __invokeIpc(IPC.openrouter.getConnection)
    await __invokeIpc(IPC.openrouter.refreshConnection)
    expect(fetchKeyInfo).toHaveBeenCalledTimes(2)
  })

  it('invalidates the cache when the stored key changes', async () => {
    readOpenRouterKey.mockReturnValue({ key: 'sk-a', storedPlaintext: false })
    fetchKeyInfo.mockResolvedValue({ ok: true, value: { label: null, limit: null, usage: 0, isFreeTier: false, keyHash: 'h' } })
    fetchCredits.mockResolvedValue({ ok: true, value: { totalCredits: 1, totalUsage: 0 } })
    await __invokeIpc(IPC.openrouter.getConnection)

    readOpenRouterKey.mockReturnValue({ key: 'sk-b', storedPlaintext: false })
    await __invokeIpc(IPC.openrouter.getConnection)
    expect(fetchKeyInfo).toHaveBeenCalledTimes(2)
  })
})

describe('startAuth', () => {
  it('parses allowPlaintextKey out of the payload and logs the result', async () => {
    startAuth.mockResolvedValue({ ok: true, authUrl: 'https://openrouter.ai/auth?x=1' })
    const result = await __invokeIpc(IPC.openrouter.startAuth, { allowPlaintextKey: true })
    expect(startAuth).toHaveBeenCalledWith({ allowPlaintextKey: true })
    expect(result).toEqual({ ok: true, authUrl: 'https://openrouter.ai/auth?x=1' })
    expect(logActivity).toHaveBeenCalledWith('info', expect.any(String), expect.anything())
  })

  it('treats a missing/invalid payload as no options', async () => {
    startAuth.mockResolvedValue({ ok: true, authUrl: 'https://openrouter.ai/auth' })
    await __invokeIpc(IPC.openrouter.startAuth, undefined)
    expect(startAuth).toHaveBeenCalledWith({})
  })

  it('logs a warning-level activity entry when starting fails', async () => {
    startAuth.mockResolvedValue({ ok: false, error: { code: 'openrouterAuthInProgress' } })
    await __invokeIpc(IPC.openrouter.startAuth, {})
    expect(logActivity).toHaveBeenCalledWith('warn', expect.any(String), expect.anything())
  })
})

describe('cancelAuth', () => {
  it('delegates to authFlow.cancelAuth', async () => {
    cancelAuth.mockReturnValue({ ok: true })
    const result = await __invokeIpc(IPC.openrouter.cancelAuth)
    expect(result).toEqual({ ok: true })
    expect(cancelAuth).toHaveBeenCalled()
  })
})

describe('submitAuthCode', () => {
  it('rejects a non-string payload without calling authFlow', async () => {
    const result = await __invokeIpc(IPC.openrouter.submitAuthCode, { codeOrUrl: 42 })
    expect(result).toEqual({ ok: false, error: { code: 'openrouterInvalidCode' } })
    expect(submitAuthCode).not.toHaveBeenCalled()
  })

  it('forwards a string code and logs on success', async () => {
    submitAuthCode.mockResolvedValue({ ok: true })
    const result = await __invokeIpc(IPC.openrouter.submitAuthCode, { codeOrUrl: 'the-code' })
    expect(submitAuthCode).toHaveBeenCalledWith('the-code')
    expect(result).toEqual({ ok: true })
    expect(logActivity).toHaveBeenCalledWith('info', expect.any(String))
  })

  it('does not log success when the exchange fails', async () => {
    submitAuthCode.mockResolvedValue({ ok: false, error: { code: 'openrouterInvalidCode' } })
    await __invokeIpc(IPC.openrouter.submitAuthCode, { codeOrUrl: 'bad' })
    expect(logActivity).not.toHaveBeenCalled()
  })
})

describe('disconnect', () => {
  it('cancels any auth flow, clears the key, and logs', async () => {
    const result = await __invokeIpc(IPC.openrouter.disconnect)
    expect(result).toEqual({ ok: true })
    expect(cancelAuth).toHaveBeenCalled()
    expect(clearOpenRouterKey).toHaveBeenCalled()
    expect(logActivity).toHaveBeenCalledWith('info', expect.any(String))
  })

  it('returns an unexpected error if clearing the key throws', async () => {
    clearOpenRouterKey.mockImplementation(() => {
      throw new Error('disk error')
    })
    const result = await __invokeIpc(IPC.openrouter.disconnect)
    expect(result).toMatchObject({ ok: false, error: { code: 'unexpected' } })
  })
})

describe('listModels', () => {
  it('defaults refresh to false', async () => {
    getModelCatalog.mockResolvedValue({ ok: true, catalog: { models: [], fetchedAt: 'now', stale: false } })
    await __invokeIpc(IPC.openrouter.listModels, undefined)
    expect(getModelCatalog).toHaveBeenCalledWith({ refresh: false })
  })

  it('forwards refresh: true', async () => {
    getModelCatalog.mockResolvedValue({ ok: true, catalog: { models: [], fetchedAt: 'now', stale: false } })
    await __invokeIpc(IPC.openrouter.listModels, { refresh: true })
    expect(getModelCatalog).toHaveBeenCalledWith({ refresh: true })
  })
})

describe('getSettings / setSettings', () => {
  it('reads settings from the repository', async () => {
    getOpenRouterSettings.mockReturnValue({ modelId: 'm', reasoningEffort: 'default', toolApproval: { askFor: [] } })
    const result = await __invokeIpc(IPC.openrouter.getSettings)
    expect(result).toEqual({ modelId: 'm', reasoningEffort: 'default', toolApproval: { askFor: [] } })
  })

  it('rejects an invalid settings payload', async () => {
    const result = await __invokeIpc(IPC.openrouter.setSettings, { modelId: '' })
    expect(result).toEqual({ ok: false, error: { code: 'invalidOpenRouterSettings' } })
    expect(setOpenRouterSettings).not.toHaveBeenCalled()
  })

  it('normalizes the tool approval list before saving', async () => {
    const payload = {
      modelId: 'openai/gpt-5',
      reasoningEffort: 'high',
      toolApproval: { askFor: ['queue_job', 'queue_job', '  ', ' exclude_job '] }
    }
    const expectedSettings = { modelId: 'openai/gpt-5', reasoningEffort: 'high', toolApproval: { askFor: ['queue_job', 'exclude_job'] } }
    const result = await __invokeIpc(IPC.openrouter.setSettings, payload)
    expect(result).toEqual({ ok: true, settings: expectedSettings })
    expect(setOpenRouterSettings).toHaveBeenCalledWith(expectedSettings)
  })

  it('accepts an explicitly empty ask-for list (the user unchecked every tool) rather than reviving the defaults', async () => {
    const payload = { modelId: 'm', reasoningEffort: 'default', toolApproval: { askFor: [] } }
    const result = await __invokeIpc(IPC.openrouter.setSettings, payload)
    expect(result).toEqual({ ok: true, settings: { modelId: 'm', reasoningEffort: 'default', toolApproval: { askFor: [] } } })
  })
})

describe('settings.getAgentMode / setAgentMode', () => {
  it('reads the current mode', async () => {
    getAgentMode.mockReturnValue('cli')
    expect(await __invokeIpc(IPC.settings.getAgentMode)).toBe('cli')
  })

  it('rejects an invalid mode', async () => {
    const result = await __invokeIpc(IPC.settings.setAgentMode, { mode: 'not-a-mode' })
    expect(result).toEqual({ ok: false, error: { code: 'invalidAgentMode' } })
    expect(setAgentMode).not.toHaveBeenCalled()
  })

  it('sets the mode, broadcasts it, and logs', async () => {
    const result = await __invokeIpc(IPC.settings.setAgentMode, { mode: 'openrouter' })
    expect(result).toEqual({ ok: true, mode: 'openrouter' })
    expect(setAgentMode).toHaveBeenCalledWith('openrouter')
    expect(broadcastAgentModeChanged).toHaveBeenCalledWith('openrouter')
    expect(logActivity).toHaveBeenCalledWith('info', expect.any(String))
  })
})

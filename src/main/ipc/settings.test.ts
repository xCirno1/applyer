import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../db/testDb'
import type * as schema from '../db/schema'
import { IPC } from '@shared/types/ipcEvents'
import { __invokeIpc, __resetElectronMock, __setEncryptionAvailable } from '../../../test/mocks/electron'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../db/index', () => ({
  getDb: () => testDb,
  setDatabaseEncryptionMode: vi.fn()
}))

const writeAgentInstructions = vi.hoisted(() => vi.fn())
vi.mock('../config/agentInstructions', () => ({ writeAgentInstructions }))

const logActivity = vi.hoisted(() => vi.fn())
vi.mock('../db/repositories/activityLogRepository', () => ({ logActivity }))

import { registerSettingsIpc } from './settings'
import { getCustomSystemPromptRaw, setStorageMode } from '../db/repositories/settingsRepository'
import { saveCustomSystemPrompt } from '../config/customSystemPrompt'
import { CUSTOM_SYSTEM_PROMPT_MAX_LENGTH } from '@shared/types/customSystemPrompt'

beforeEach(() => {
  __resetElectronMock()
  testDb = createTestDb().db
  writeAgentInstructions.mockReset()
  logActivity.mockReset()
  registerSettingsIpc()
})

describe('settings:getCustomSystemPrompt', () => {
  it('answers with an empty prompt when none is stored', () => {
    expect(__invokeIpc(IPC.settings.getCustomSystemPrompt)).toEqual({
      ok: true,
      prompt: ''
    })
  })

  it('answers with the stored prompt', () => {
    setStorageMode('encrypted')
    saveCustomSystemPrompt('Only remote roles.')
    expect(__invokeIpc(IPC.settings.getCustomSystemPrompt)).toEqual({
      ok: true,
      prompt: 'Only remote roles.'
    })
  })

  it('reports an unreadable encrypted prompt as an error rather than an empty one', () => {
    setStorageMode('encrypted')
    saveCustomSystemPrompt('Only remote roles.')
    __setEncryptionAvailable(false)
    expect(__invokeIpc(IPC.settings.getCustomSystemPrompt)).toEqual({
      ok: false,
      error: { code: 'customSystemPromptUnreadable' }
    })
  })
})

describe('settings:setCustomSystemPrompt', () => {
  it('saves the normalized prompt, rewrites the instruction file, and logs only the length', () => {
    setStorageMode('plaintext')
    const result = __invokeIpc(IPC.settings.setCustomSystemPrompt, {
      prompt: ' Only remote roles. \r\n'
    })
    expect(result).toEqual({ ok: true, prompt: 'Only remote roles.' })
    expect(getCustomSystemPromptRaw()).toBe('Only remote roles.')
    expect(writeAgentInstructions).toHaveBeenCalledTimes(1)
    expect(logActivity).toHaveBeenCalledWith('info', 'Custom system prompt updated', { length: 18 })
    expect(JSON.stringify(logActivity.mock.calls)).not.toContain('remote')
  })

  it('clears the prompt when saved empty', () => {
    setStorageMode('plaintext')
    saveCustomSystemPrompt('Only remote roles.')
    expect(__invokeIpc(IPC.settings.setCustomSystemPrompt, { prompt: '' })).toEqual({ ok: true, prompt: '' })
    expect(getCustomSystemPromptRaw()).toBeNull()
    expect(logActivity).toHaveBeenCalledWith('info', 'Custom system prompt cleared', { length: 0 })
  })

  it('refuses an over-long prompt with the limit, leaving storage and the file alone', () => {
    const result = __invokeIpc(IPC.settings.setCustomSystemPrompt, {
      prompt: 'a'.repeat(CUSTOM_SYSTEM_PROMPT_MAX_LENGTH + 1)
    })
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'customSystemPromptTooLong',
        params: { max: CUSTOM_SYSTEM_PROMPT_MAX_LENGTH }
      }
    })
    expect(getCustomSystemPromptRaw()).toBeNull()
    expect(writeAgentInstructions).not.toHaveBeenCalled()
  })

  it('refuses a malformed payload', () => {
    for (const payload of [undefined, null, 'text', { prompt: 42 }, {}]) {
      expect(__invokeIpc(IPC.settings.setCustomSystemPrompt, payload)).toEqual({
        ok: false,
        error: { code: 'invalidCustomSystemPrompt' }
      })
    }
  })

  it('reports a keychain failure in encrypted mode as an unexpected error', () => {
    setStorageMode('encrypted')
    __setEncryptionAvailable(false)
    const result = __invokeIpc(IPC.settings.setCustomSystemPrompt, {
      prompt: 'Only remote roles.'
    }) as {
      ok: boolean
      error?: { code: string }
    }
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('unexpected')
    expect(getCustomSystemPromptRaw()).toBeNull()
  })
})

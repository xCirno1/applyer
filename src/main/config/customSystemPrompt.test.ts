import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../db/testDb'
import type * as schema from '../db/schema'
import { __resetElectronMock, __setEncryptionAvailable } from '../../../test/mocks/electron'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../db/index', () => ({ getDb: () => testDb }))

beforeEach(() => {
  __resetElectronMock()
  testDb = createTestDb().db
})

import {
  CustomSystemPromptError,
  getCustomSystemPrompt,
  readCustomSystemPromptForAgent,
  rewriteCustomSystemPromptStorageMode,
  saveCustomSystemPrompt
} from './customSystemPrompt'
import {
  getCustomSystemPromptRaw,
  setCustomSystemPromptRaw,
  setStorageMode
} from '../db/repositories/settingsRepository'
import { CUSTOM_SYSTEM_PROMPT_MAX_LENGTH } from '@shared/types/customSystemPrompt'

describe('custom system prompt storage', () => {
  it('reads back as empty when nothing was ever saved', () => {
    expect(getCustomSystemPrompt()).toBe('')
    expect(getCustomSystemPromptRaw()).toBeNull()
  })

  it('stores the normalized text and returns what was stored', () => {
    setStorageMode('plaintext')
    expect(saveCustomSystemPrompt('  Remote only.  \r\n')).toBe('Remote only.')
    expect(getCustomSystemPromptRaw()).toBe('Remote only.')
    expect(getCustomSystemPrompt()).toBe('Remote only.')
  })

  it('encrypts the row in encrypted mode and decrypts it on read', () => {
    setStorageMode('encrypted')
    saveCustomSystemPrompt('Remote only.')
    const raw = getCustomSystemPromptRaw()
    expect(raw).not.toBeNull()
    expect(raw).not.toBe('Remote only.')
    expect(raw?.startsWith('enc:v1:')).toBe(true)
    expect(getCustomSystemPrompt()).toBe('Remote only.')
  })

  it('fails closed to encrypted when no storage mode was ever chosen', () => {
    saveCustomSystemPrompt('Remote only.')
    expect(getCustomSystemPromptRaw()?.startsWith('enc:v1:')).toBe(true)
  })

  it('refuses to write plaintext when encrypted mode has no keychain', () => {
    setStorageMode('encrypted')
    __setEncryptionAvailable(false)
    expect(() => saveCustomSystemPrompt('Remote only.')).toThrow(/keychain/)
    expect(getCustomSystemPromptRaw()).toBeNull()
  })

  it('deletes the row when saved empty', () => {
    setStorageMode('plaintext')
    saveCustomSystemPrompt('Remote only.')
    expect(saveCustomSystemPrompt('   ')).toBe('')
    expect(getCustomSystemPromptRaw()).toBeNull()
  })

  it('refuses non-string and over-long input with a typed error, leaving the stored text alone', () => {
    setStorageMode('plaintext')
    saveCustomSystemPrompt('Keep me.')
    const notString = (() => {
      try {
        saveCustomSystemPrompt(42)
      } catch (err) {
        return err
      }
      return null
    })()
    expect(notString).toBeInstanceOf(CustomSystemPromptError)
    expect((notString as CustomSystemPromptError).reason).toBe('notString')
    expect(() => saveCustomSystemPrompt('a'.repeat(CUSTOM_SYSTEM_PROMPT_MAX_LENGTH + 1))).toThrow(
      CustomSystemPromptError
    )
    expect(getCustomSystemPrompt()).toBe('Keep me.')
  })

  it('ignores a stored row that no longer passes validation', () => {
    setCustomSystemPromptRaw('a'.repeat(CUSTOM_SYSTEM_PROMPT_MAX_LENGTH + 10))
    expect(getCustomSystemPrompt()).toBe('')
  })

  it('throws on an encrypted row the keychain cannot open, but the agent reader degrades to empty', () => {
    setStorageMode('encrypted')
    saveCustomSystemPrompt('Remote only.')
    __setEncryptionAvailable(false)
    expect(() => getCustomSystemPrompt()).toThrow()
    expect(readCustomSystemPromptForAgent()).toBe('')
  })

  it('agent reader returns the stored text when readable', () => {
    setStorageMode('plaintext')
    saveCustomSystemPrompt('Remote only.')
    expect(readCustomSystemPromptForAgent()).toBe('Remote only.')
  })
})

describe('rewriteCustomSystemPromptStorageMode', () => {
  it('re-encodes the row for the new mode in both directions', () => {
    setStorageMode('plaintext')
    saveCustomSystemPrompt('Remote only.')
    rewriteCustomSystemPromptStorageMode('encrypted')
    expect(getCustomSystemPromptRaw()?.startsWith('enc:v1:')).toBe(true)
    rewriteCustomSystemPromptStorageMode('plaintext')
    expect(getCustomSystemPromptRaw()).toBe('Remote only.')
  })

  it('does nothing when there is no row', () => {
    rewriteCustomSystemPromptStorageMode('encrypted')
    expect(getCustomSystemPromptRaw()).toBeNull()
  })

  it('drops an empty row rather than encrypting nothing', () => {
    setCustomSystemPromptRaw('')
    rewriteCustomSystemPromptStorageMode('encrypted')
    expect(getCustomSystemPromptRaw()).toBeNull()
  })
})

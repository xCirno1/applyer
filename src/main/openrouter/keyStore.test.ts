import { describe, it, expect, beforeEach, vi } from 'vitest'
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
  storeOpenRouterKey,
  readOpenRouterKey,
  clearOpenRouterKey,
  OpenRouterKeychainUnavailableError
} from './keyStore'
import { getOpenRouterApiKeyRaw } from '../db/repositories/settingsRepository'

describe('readOpenRouterKey', () => {
  it('returns null when nothing is stored', () => {
    expect(readOpenRouterKey()).toBeNull()
  })
})

describe('storeOpenRouterKey / readOpenRouterKey with a keychain available', () => {
  it('stores the key encrypted and reports storedPlaintext: false', () => {
    storeOpenRouterKey('sk-or-v1-abc123')
    const raw = getOpenRouterApiKeyRaw()
    expect(raw).toMatch(/^enc:v1:/)
    expect(readOpenRouterKey()).toEqual({ key: 'sk-or-v1-abc123', storedPlaintext: false })
  })

  it('ignores allowPlaintext when a keychain is available (still encrypts)', () => {
    storeOpenRouterKey('sk-or-v1-abc123', { allowPlaintext: true })
    expect(getOpenRouterApiKeyRaw()).toMatch(/^enc:v1:/)
    expect(readOpenRouterKey()?.storedPlaintext).toBe(false)
  })

  it('overwrites a previously stored key', () => {
    storeOpenRouterKey('sk-or-v1-old')
    storeOpenRouterKey('sk-or-v1-new')
    expect(readOpenRouterKey()?.key).toBe('sk-or-v1-new')
  })
})

describe('storeOpenRouterKey with no keychain available', () => {
  beforeEach(() => {
    __setEncryptionAvailable(false)
  })

  it('throws OpenRouterKeychainUnavailableError when plaintext is not explicitly allowed', () => {
    expect(() => storeOpenRouterKey('sk-or-v1-abc123')).toThrow(OpenRouterKeychainUnavailableError)
    expect(getOpenRouterApiKeyRaw()).toBeNull()
  })

  it('stores plaintext when explicitly allowed, and reports storedPlaintext: true', () => {
    storeOpenRouterKey('sk-or-v1-abc123', { allowPlaintext: true })
    expect(getOpenRouterApiKeyRaw()).toBe('sk-or-v1-abc123')
    expect(readOpenRouterKey()).toEqual({ key: 'sk-or-v1-abc123', storedPlaintext: true })
  })
})

describe('readOpenRouterKey when a previously encrypted value can no longer be decrypted', () => {
  it('returns null instead of throwing, and logs a warning', () => {
    storeOpenRouterKey('sk-or-v1-abc123')
    __setEncryptionAvailable(false)
    expect(readOpenRouterKey()).toBeNull()
  })
})

describe('clearOpenRouterKey', () => {
  it('removes a stored key', () => {
    storeOpenRouterKey('sk-or-v1-abc123')
    clearOpenRouterKey()
    expect(readOpenRouterKey()).toBeNull()
    expect(getOpenRouterApiKeyRaw()).toBeNull()
  })

  it('is a no-op when nothing is stored', () => {
    expect(() => clearOpenRouterKey()).not.toThrow()
  })
})

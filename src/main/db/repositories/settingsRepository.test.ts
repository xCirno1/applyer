import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../testDb'
import type * as schema from '../schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../index', () => ({ getDb: () => testDb }))

beforeEach(() => {
  testDb = createTestDb().db
})

import {
  getStorageMode,
  setStorageMode,
  isOnboardingCompleted,
  markOnboardingCompleted,
  getAutoStartCommand,
  setAutoStartCommand
} from './settingsRepository'

describe('storage mode', () => {
  it('defaults to null (unset)', () => {
    expect(getStorageMode()).toBeNull()
  })

  it('round-trips encrypted/plaintext', () => {
    setStorageMode('encrypted')
    expect(getStorageMode()).toBe('encrypted')
    setStorageMode('plaintext')
    expect(getStorageMode()).toBe('plaintext')
  })
})

describe('onboarding completion', () => {
  it('defaults to false', () => {
    expect(isOnboardingCompleted()).toBe(false)
  })

  it('becomes true after markOnboardingCompleted', () => {
    markOnboardingCompleted()
    expect(isOnboardingCompleted()).toBe(true)
  })
})

describe('auto-start command', () => {
  it('defaults to an empty string', () => {
    expect(getAutoStartCommand()).toBe('')
  })

  it('round-trips a value and can be reset to empty (disabled)', () => {
    setAutoStartCommand('claude')
    expect(getAutoStartCommand()).toBe('claude')
    setAutoStartCommand('')
    expect(getAutoStartCommand()).toBe('')
  })
})

describe('settings are independent keys', () => {
  it('does not let one setting clobber another', () => {
    setStorageMode('encrypted')
    markOnboardingCompleted()
    setAutoStartCommand('codex')
    expect(getStorageMode()).toBe('encrypted')
    expect(isOnboardingCompleted()).toBe(true)
    expect(getAutoStartCommand()).toBe('codex')
  })
})

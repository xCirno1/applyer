import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../testDb'
import { appSettings } from '../schema'
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
  setAutoStartCommand,
  getIndexedJobsRetentionDays,
  setIndexedJobsRetentionDays,
  getBrowserPreference,
  setBrowserPreference,
  getNotificationPreferences,
  setNotificationPreferences,
  getNotificationLocale,
  setNotificationLocale
} from './settingsRepository'
import { INDEXED_JOBS_RETENTION_DEFAULT_DAYS } from '@shared/constants'
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@shared/types/notification'

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

describe('indexed jobs retention', () => {
  it('defaults to INDEXED_JOBS_RETENTION_DEFAULT_DAYS', () => {
    expect(getIndexedJobsRetentionDays()).toBe(INDEXED_JOBS_RETENTION_DEFAULT_DAYS)
  })

  it('round-trips a day count', () => {
    setIndexedJobsRetentionDays(90)
    expect(getIndexedJobsRetentionDays()).toBe(90)
  })

  it('round-trips "unlimited"', () => {
    setIndexedJobsRetentionDays('unlimited')
    expect(getIndexedJobsRetentionDays()).toBe('unlimited')
  })
})

describe('browser preference', () => {
  it('defaults to "auto"', () => {
    expect(getBrowserPreference()).toBe('auto')
  })

  it('round-trips chrome/msedge/managed', () => {
    setBrowserPreference('chrome')
    expect(getBrowserPreference()).toBe('chrome')
    setBrowserPreference('msedge')
    expect(getBrowserPreference()).toBe('msedge')
    setBrowserPreference('managed')
    expect(getBrowserPreference()).toBe('managed')
  })

  it('falls back to "auto" for an unrecognized stored value', () => {
    // Simulates a value from a future/older app version rather than one this app wrote itself.
    testDb.insert(appSettings).values({ key: 'browser_preference', value: 'firefox' }).run()
    expect(getBrowserPreference()).toBe('auto')
  })
})

describe('notification preferences', () => {
  it('defaults every notification category to enabled', () => {
    expect(getNotificationPreferences()).toEqual(DEFAULT_NOTIFICATION_PREFERENCES)
  })

  it('round-trips independent notification categories', () => {
    const preferences = {
      enabled: true,
      verificationRequired: false,
      jobFilled: true,
      jobFailed: false
    }
    setNotificationPreferences(preferences)
    expect(getNotificationPreferences()).toEqual(preferences)
  })

  it('falls back safely when the stored JSON is malformed or incomplete', () => {
    testDb.insert(appSettings).values({ key: 'notification_preferences', value: '{broken' }).run()
    expect(getNotificationPreferences()).toEqual(DEFAULT_NOTIFICATION_PREFERENCES)

    testDb
      .insert(appSettings)
      .values({ key: 'notification_preferences', value: JSON.stringify({ enabled: false }) })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify({ enabled: false }) } })
      .run()
    expect(getNotificationPreferences()).toEqual(DEFAULT_NOTIFICATION_PREFERENCES)
  })
})

describe('notification locale', () => {
  it('defaults to English and round-trips a renderer-synchronized locale', () => {
    expect(getNotificationLocale()).toBe('en')
    setNotificationLocale('id')
    expect(getNotificationLocale()).toBe('id')
  })

  it('falls back to English for an unrecognized cached locale', () => {
    testDb.insert(appSettings).values({ key: 'notification_locale', value: 'xx' }).run()
    expect(getNotificationLocale()).toBe('en')
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

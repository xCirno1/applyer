import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
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
  getRemoteBrowserSettings,
  setRemoteBrowserSettings,
  getAgentPermissions,
  setAgentPermissions,
  getAllowLocalAddresses,
  setAllowLocalAddresses,
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

describe('remote browser settings', () => {
  it('defaults to disabled with the loopback endpoint', () => {
    expect(getRemoteBrowserSettings()).toEqual({ enabled: false, endpoint: 'http://127.0.0.1:9222' })
  })

  it('round-trips an enabled configuration with a custom endpoint', () => {
    setRemoteBrowserSettings({ enabled: true, endpoint: 'ws://localhost:9333/devtools/browser/abc' })
    expect(getRemoteBrowserSettings()).toEqual({ enabled: true, endpoint: 'ws://localhost:9333/devtools/browser/abc' })
    setRemoteBrowserSettings({ enabled: false, endpoint: 'http://127.0.0.1:9222' })
    expect(getRemoteBrowserSettings()).toEqual({ enabled: false, endpoint: 'http://127.0.0.1:9222' })
  })

  it('treats an unreadable stored value as disabled', () => {
    testDb.insert(appSettings).values({ key: 'remote_browser', value: '{not json' }).run()
    expect(getRemoteBrowserSettings()).toEqual({ enabled: false, endpoint: 'http://127.0.0.1:9222' })
  })

  it('treats a stored value with an unusable endpoint as disabled', () => {
    testDb
      .insert(appSettings)
      .values({ key: 'remote_browser', value: JSON.stringify({ enabled: true, endpoint: 'file:///tmp/x' }) })
      .run()
    expect(getRemoteBrowserSettings()).toEqual({ enabled: false, endpoint: 'http://127.0.0.1:9222' })
  })

  it('drops unknown fields instead of persisting them', () => {
    setRemoteBrowserSettings({ enabled: true, endpoint: 'http://127.0.0.1:9222', extra: 1 } as never)
    const row = testDb.select().from(appSettings).where(eq(appSettings.key, 'remote_browser')).get()
    expect(JSON.parse(row!.value)).toEqual({ enabled: true, endpoint: 'http://127.0.0.1:9222' })
  })
})

describe('agent permissions', () => {
  it('allows field completion but denies document uploads by default', () => {
    expect(getAgentPermissions()).toEqual({
      autoCompleteFields: true,
      autoUploadDocuments: false,
      autoPressButtons: false
    })
  })

  it('round-trips each permission independently', () => {
    setAgentPermissions({ autoCompleteFields: true, autoUploadDocuments: false, autoPressButtons: true })
    expect(getAgentPermissions()).toEqual({ autoCompleteFields: true, autoUploadDocuments: false, autoPressButtons: true })
    setAgentPermissions({ autoCompleteFields: false, autoUploadDocuments: true, autoPressButtons: false })
    expect(getAgentPermissions()).toEqual({ autoCompleteFields: false, autoUploadDocuments: true, autoPressButtons: false })
  })

  it('fails closed for malformed stored permissions', () => {
    testDb.insert(appSettings).values({ key: 'agent_permissions', value: '{broken' }).run()
    expect(getAgentPermissions()).toEqual({ autoCompleteFields: false, autoUploadDocuments: false, autoPressButtons: false })
  })

  it('fails closed for incomplete stored permissions', () => {
    testDb
      .insert(appSettings)
      .values({ key: 'agent_permissions', value: JSON.stringify({ autoCompleteFields: true }) })
      .run()
    expect(getAgentPermissions()).toEqual({ autoCompleteFields: false, autoUploadDocuments: false, autoPressButtons: false })
  })

  it('upgrades permissions saved before button pressing was introduced', () => {
    testDb
      .insert(appSettings)
      .values({
        key: 'agent_permissions',
        value: JSON.stringify({ autoCompleteFields: true, autoUploadDocuments: false })
      })
      .run()
    expect(getAgentPermissions()).toEqual({
      autoCompleteFields: true,
      autoUploadDocuments: false,
      autoPressButtons: false
    })
  })
})

describe('local address permission', () => {
  it('defaults to denied and round-trips explicit permission', () => {
    expect(getAllowLocalAddresses()).toBe(false)
    setAllowLocalAddresses(true)
    expect(getAllowLocalAddresses()).toBe(true)
    setAllowLocalAddresses(false)
    expect(getAllowLocalAddresses()).toBe(false)
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
      permissionRequired: true,
      jobFilled: true,
      jobFailed: false
    }
    setNotificationPreferences(preferences)
    expect(getNotificationPreferences()).toEqual(preferences)
  })

  it('adds the permission category without resetting legacy choices', () => {
    const legacy = {
      enabled: false,
      verificationRequired: false,
      jobFilled: true,
      jobFailed: false
    }
    testDb
      .insert(appSettings)
      .values({ key: 'notification_preferences', value: JSON.stringify(legacy) })
      .run()

    expect(getNotificationPreferences()).toEqual({
      ...legacy,
      permissionRequired: DEFAULT_NOTIFICATION_PREFERENCES.permissionRequired
    })
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

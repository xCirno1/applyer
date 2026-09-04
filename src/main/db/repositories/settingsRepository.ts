import { eq } from 'drizzle-orm'
import { getDb } from '../index'
import { appSettings } from '../schema'
import type { StorageMode } from '@shared/types/profile'
import type { AutoStartCommand, BrowserPreference } from '@shared/types/ipcEvents'
import type { IndexedJobsRetention } from '@shared/types/indexedJob'
import { INDEXED_JOBS_RETENTION_DEFAULT_DAYS } from '@shared/constants'
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  DEFAULT_NOTIFICATION_LOCALE,
  isNotificationLocale,
  isNotificationPreferences,
  type NotificationLocale,
  type NotificationPreferences
} from '@shared/types/notification'

const STORAGE_MODE_KEY = 'storage_mode'
const ONBOARDING_COMPLETED_KEY = 'onboarding_completed'
const AUTO_START_COMMAND_KEY = 'auto_start_command'
const INDEXED_JOBS_RETENTION_KEY = 'indexed_jobs_retention_days'
const BROWSER_PREFERENCE_KEY = 'browser_preference'
const NOTIFICATION_PREFERENCES_KEY = 'notification_preferences'
const NOTIFICATION_LOCALE_KEY = 'notification_locale'

function getSetting(key: string): string | null {
  const row = getDb().select().from(appSettings).where(eq(appSettings.key, key)).get()
  return row?.value ?? null
}

function setSetting(key: string, value: string): void {
  getDb()
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } })
    .run()
}

export function getStorageMode(): StorageMode | null {
  const value = getSetting(STORAGE_MODE_KEY)
  return value === 'encrypted' || value === 'plaintext' ? value : null
}

export function setStorageMode(mode: StorageMode): void {
  setSetting(STORAGE_MODE_KEY, mode)
}

export function isOnboardingCompleted(): boolean {
  return getSetting(ONBOARDING_COMPLETED_KEY) === '1'
}

export function markOnboardingCompleted(): void {
  setSetting(ONBOARDING_COMPLETED_KEY, '1')
}

export function getAutoStartCommand(): AutoStartCommand {
  return getSetting(AUTO_START_COMMAND_KEY) ?? ''
}

export function setAutoStartCommand(command: AutoStartCommand): void {
  setSetting(AUTO_START_COMMAND_KEY, command)
}

export function getIndexedJobsRetentionDays(): IndexedJobsRetention {
  const value = getSetting(INDEXED_JOBS_RETENTION_KEY)
  if (value === 'unlimited') return 'unlimited'
  const parsed = value ? Number.parseInt(value, 10) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : INDEXED_JOBS_RETENTION_DEFAULT_DAYS
}

export function setIndexedJobsRetentionDays(value: IndexedJobsRetention): void {
  setSetting(INDEXED_JOBS_RETENTION_KEY, value === 'unlimited' ? 'unlimited' : String(value))
}

export function getBrowserPreference(): BrowserPreference {
  const value = getSetting(BROWSER_PREFERENCE_KEY)
  return value === 'chrome' || value === 'msedge' || value === 'managed' ? value : 'auto'
}

export function setBrowserPreference(preference: BrowserPreference): void {
  setSetting(BROWSER_PREFERENCE_KEY, preference)
}

export function getNotificationPreferences(): NotificationPreferences {
  const value = getSetting(NOTIFICATION_PREFERENCES_KEY)
  if (!value) return { ...DEFAULT_NOTIFICATION_PREFERENCES }
  try {
    const parsed: unknown = JSON.parse(value)
    return isNotificationPreferences(parsed) ? parsed : { ...DEFAULT_NOTIFICATION_PREFERENCES }
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES }
  }
}

export function setNotificationPreferences(preferences: NotificationPreferences): void {
  setSetting(NOTIFICATION_PREFERENCES_KEY, JSON.stringify(preferences))
}

/** Last renderer-resolved locale, cached so main can localize events before a window finishes loading next launch. */
export function getNotificationLocale(): NotificationLocale {
  const value = getSetting(NOTIFICATION_LOCALE_KEY)
  return isNotificationLocale(value) ? value : DEFAULT_NOTIFICATION_LOCALE
}

export function setNotificationLocale(locale: NotificationLocale): void {
  setSetting(NOTIFICATION_LOCALE_KEY, locale)
}

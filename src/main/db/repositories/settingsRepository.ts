import { eq } from 'drizzle-orm'
import { getDb } from '../index'
import { appSettings } from '../schema'
import type { StorageMode } from '@shared/types/profile'

const STORAGE_MODE_KEY = 'storage_mode'
const ONBOARDING_COMPLETED_KEY = 'onboarding_completed'

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

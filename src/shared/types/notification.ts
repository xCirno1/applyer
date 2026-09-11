import { getSettings } from '@shared/settings'

export interface NotificationPreferences {
  enabled: boolean
  verificationRequired: boolean
  permissionRequired: boolean
  jobFilled: boolean
  jobFailed: boolean
}

export type NotificationTestKind = 'verificationRequired' | 'permissionRequired' | 'jobFilled' | 'jobFailed'
export type NotificationLocale = 'en' | 'id'

const settings = getSettings()

export const DEFAULT_NOTIFICATION_LOCALE: NotificationLocale = settings.notificationDefaultLocale

export function isNotificationTestKind(value: unknown): value is NotificationTestKind {
  return (
    value === 'verificationRequired' ||
    value === 'permissionRequired' ||
    value === 'jobFilled' ||
    value === 'jobFailed'
  )
}

export function isNotificationLocale(value: unknown): value is NotificationLocale {
  return value === 'en' || value === 'id'
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled: settings.notificationEnabledByDefault,
  verificationRequired: settings.notificationVerificationRequiredByDefault,
  permissionRequired: settings.notificationPermissionRequiredByDefault,
  jobFilled: settings.notificationJobFilledByDefault,
  jobFailed: settings.notificationJobFailedByDefault
}

/** Runtime guard for settings read from IPC, disk, or an imported bundle. */
export function isNotificationPreferences(value: unknown): value is NotificationPreferences {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<keyof NotificationPreferences, unknown>
  return (
    typeof candidate.enabled === 'boolean' &&
    typeof candidate.verificationRequired === 'boolean' &&
    typeof candidate.permissionRequired === 'boolean' &&
    typeof candidate.jobFilled === 'boolean' &&
    typeof candidate.jobFailed === 'boolean'
  )
}

export interface NotificationPreferences {
  enabled: boolean
  verificationRequired: boolean
  jobFilled: boolean
  jobFailed: boolean
}

export type NotificationTestKind = 'verificationRequired' | 'jobFilled' | 'jobFailed'
export type NotificationLocale = 'en' | 'id'

export const DEFAULT_NOTIFICATION_LOCALE: NotificationLocale = 'en'

export function isNotificationTestKind(value: unknown): value is NotificationTestKind {
  return value === 'verificationRequired' || value === 'jobFilled' || value === 'jobFailed'
}

export function isNotificationLocale(value: unknown): value is NotificationLocale {
  return value === 'en' || value === 'id'
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled: true,
  verificationRequired: true,
  jobFilled: true,
  jobFailed: true
}

/** Runtime guard for settings read from IPC, disk, or an imported bundle. */
export function isNotificationPreferences(value: unknown): value is NotificationPreferences {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<keyof NotificationPreferences, unknown>
  return (
    typeof candidate.enabled === 'boolean' &&
    typeof candidate.verificationRequired === 'boolean' &&
    typeof candidate.jobFilled === 'boolean' &&
    typeof candidate.jobFailed === 'boolean'
  )
}

import { BrowserWindow, Notification } from 'electron'
import { getNotificationLocale, getNotificationPreferences } from './db/repositories/settingsRepository'
import { appLogger } from './logger'
import { NOTIFICATION_CATALOGS, notificationMessage } from './notificationCatalogs'
import type { CaptchaDetectedPayload } from '@shared/types/ipcEvents'
import type { JobRecord } from '@shared/types/job'
import type { NotificationLocale, NotificationPreferences, NotificationTestKind } from '@shared/types/notification'

export interface DesktopNotificationContent {
  title: string
  body: string
}

const activeNotifications = new Set<Notification>()

export function contentForJobUpdate(
  job: JobRecord,
  preferences: NotificationPreferences,
  locale: NotificationLocale = 'en'
): DesktopNotificationContent | null {
  if (!preferences.enabled) return null
  if (job.status === 'filled' && preferences.jobFilled) {
    return notificationMessage(locale, 'jobFilled', job.title, job.company)
  }
  if (job.status === 'failed' && preferences.jobFailed) {
    return notificationMessage(locale, 'jobFailed', job.title, job.company)
  }
  return null
}

export function contentForVerification(
  payload: CaptchaDetectedPayload,
  preferences: NotificationPreferences,
  locale: NotificationLocale = 'en'
): DesktopNotificationContent | null {
  if (!preferences.enabled || !preferences.verificationRequired) return null
  return notificationMessage(locale, 'verificationRequired', payload.jobTitle, payload.company)
}

function focusMainWindow(): void {
  const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

export function testNotificationContent(
  kind: NotificationTestKind,
  locale: NotificationLocale = 'en'
): DesktopNotificationContent {
  const catalog = NOTIFICATION_CATALOGS[locale]
  return notificationMessage(locale, kind, catalog.testJobTitle, catalog.testCompany)
}

export function showDesktopNotification(content: DesktopNotificationContent): boolean {
  try {
    if (!Notification.isSupported()) {
      appLogger.warn('Desktop notifications are not supported on this system')
      return false
    }
    const notification = new Notification(content)
    activeNotifications.add(notification)
    notification.on('click', focusMainWindow)
    notification.once('close', () => activeNotifications.delete(notification))
    notification.once('failed', (_event, error) => {
      activeNotifications.delete(notification)
      appLogger.warn(`Desktop notification failed: ${error}`)
    })
    notification.show()
    return true
  } catch (err) {
    appLogger.warn(`Could not show desktop notification: ${String(err)}`)
    return false
  }
}

export function sendTestNotification(kind: NotificationTestKind): boolean {
  return showDesktopNotification(testNotificationContent(kind, getNotificationLocale()))
}

export function notifyForJobUpdate(job: JobRecord): void {
  try {
    const content = contentForJobUpdate(job, getNotificationPreferences(), getNotificationLocale())
    if (content) showDesktopNotification(content)
  } catch (err) {
    // Notification delivery is best-effort and must never break the job
    // update or prevent its renderer broadcast after the DB write succeeded.
    appLogger.warn(`Could not prepare job notification: ${String(err)}`)
  }
}

export function notifyForVerification(payload: CaptchaDetectedPayload): void {
  try {
    const content = contentForVerification(payload, getNotificationPreferences(), getNotificationLocale())
    if (content) showDesktopNotification(content)
  } catch (err) {
    appLogger.warn(`Could not prepare verification notification: ${String(err)}`)
  }
}

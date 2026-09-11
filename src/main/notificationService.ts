import { BrowserWindow, Notification } from 'electron'
import { getNotificationLocale, getNotificationPreferences } from './db/repositories/settingsRepository'
import { appLogger } from './logger'
import { NOTIFICATION_CATALOGS, notificationMessage } from './notificationCatalogs'
import type { CaptchaDetectedPayload } from '@shared/types/ipcEvents'
import type { AgentPermissionRequest } from '@shared/types/agentPermissions'
import type { JobRecord } from '@shared/types/job'
import type { NotificationLocale, NotificationPreferences, NotificationTestKind } from '@shared/types/notification'

export interface DesktopNotificationContent {
  title: string
  body: string
}

const activeNotifications = new Set<Notification>()
let activeAgentPermissionNotification: Notification | null = null

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

export function contentForPermissionRequest(
  payload: AgentPermissionRequest,
  preferences: NotificationPreferences,
  locale: NotificationLocale = 'en'
): DesktopNotificationContent | null {
  if (!preferences.enabled || !preferences.permissionRequired) return null
  return notificationMessage(locale, 'permissionRequired', payload.jobTitle, payload.company)
}

function activeMainWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed()) ?? null
}

function isMainWindowFocused(): boolean {
  return activeMainWindow()?.isFocused() ?? false
}

function focusMainWindow(): void {
  const window = activeMainWindow()
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

function deliverDesktopNotification(
  content: DesktopNotificationContent,
  onFinished?: (notification: Notification) => void
): Notification | null {
  try {
    if (!Notification.isSupported()) {
      appLogger.warn('Desktop notifications are not supported on this system')
      return null
    }
    const notification = new Notification(content)
    activeNotifications.add(notification)
    notification.on('click', focusMainWindow)
    notification.once('close', () => {
      activeNotifications.delete(notification)
      onFinished?.(notification)
    })
    notification.once('failed', (_event, error) => {
      activeNotifications.delete(notification)
      onFinished?.(notification)
      appLogger.warn(`Desktop notification failed: ${error}`)
    })
    notification.show()
    return notification
  } catch (err) {
    appLogger.warn(`Could not show desktop notification: ${String(err)}`)
    return null
  }
}

export function showDesktopNotification(content: DesktopNotificationContent): boolean {
  return deliverDesktopNotification(content) !== null
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

export function notifyForPermissionRequest(payload: AgentPermissionRequest): void {
  try {
    if (isMainWindowFocused() || activeAgentPermissionNotification) return
    const content = contentForPermissionRequest(payload, getNotificationPreferences(), getNotificationLocale())
    if (!content) return
    const notification = deliverDesktopNotification(content, (finished) => {
      if (activeAgentPermissionNotification === finished) activeAgentPermissionNotification = null
    })
    if (notification) activeAgentPermissionNotification = notification
  } catch (error) {
    appLogger.warn(`Could not prepare agent permission notification: ${String(error)}`)
  }
}

export function clearPermissionRequestNotification(): void {
  const notification = activeAgentPermissionNotification
  activeAgentPermissionNotification = null
  if (!notification) return
  try {
    notification.close()
  } catch (error) {
    appLogger.warn(`Could not close agent permission notification: ${String(error)}`)
  }
}

import { BrowserWindow, Notification } from 'electron'
import { getNotificationPreferences } from './db/repositories/settingsRepository'
import { appLogger } from './logger'
import type { CaptchaDetectedPayload } from '@shared/types/ipcEvents'
import type { JobRecord } from '@shared/types/job'
import type { NotificationPreferences } from '@shared/types/notification'
import type { NotificationTestKind } from '@shared/types/notification'

export interface DesktopNotificationContent {
  title: string
  body: string
}

const activeNotifications = new Set<Notification>()

export function contentForJobUpdate(
  job: JobRecord,
  preferences: NotificationPreferences
): DesktopNotificationContent | null {
  if (!preferences.enabled) return null
  const jobName = `${job.title} at ${job.company}`
  if (job.status === 'filled' && preferences.jobFilled) {
    return {
      title: 'Application ready for review',
      body: `${jobName} has been filled and is ready for your review.`
    }
  }
  if (job.status === 'failed' && preferences.jobFailed) {
    return {
      title: 'Job could not be completed',
      body: `${jobName} failed. Open Applyer for details or to retry.`
    }
  }
  return null
}

export function contentForVerification(
  payload: CaptchaDetectedPayload,
  preferences: NotificationPreferences
): DesktopNotificationContent | null {
  if (!preferences.enabled || !preferences.verificationRequired) return null
  return {
    title: 'Verification required',
    body: `${payload.jobTitle} at ${payload.company} needs your attention in the browser window.`
  }
}

function focusMainWindow(): void {
  const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

export function testNotificationContent(kind: NotificationTestKind): DesktopNotificationContent {
  switch (kind) {
    case 'verificationRequired':
      return {
        title: 'Verification required',
        body: 'Test Job at Example Company needs your attention in the browser window.'
      }
    case 'jobFilled':
      return {
        title: 'Application ready for review',
        body: 'Test Job at Example Company has been filled and is ready for your review.'
      }
    case 'jobFailed':
      return {
        title: 'Job could not be completed',
        body: 'Test Job at Example Company failed. Open Applyer for details or to retry.'
      }
  }
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
  return showDesktopNotification(testNotificationContent(kind))
}

export function notifyForJobUpdate(job: JobRecord): void {
  try {
    const content = contentForJobUpdate(job, getNotificationPreferences())
    if (content) showDesktopNotification(content)
  } catch (err) {
    // Notification delivery is best-effort and must never break the job
    // update or prevent its renderer broadcast after the DB write succeeded.
    appLogger.warn(`Could not prepare job notification: ${String(err)}`)
  }
}

export function notifyForVerification(payload: CaptchaDetectedPayload): void {
  try {
    const content = contentForVerification(payload, getNotificationPreferences())
    if (content) showDesktopNotification(content)
  } catch (err) {
    appLogger.warn(`Could not prepare verification notification: ${String(err)}`)
  }
}

import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow, Notification } from 'electron'

vi.mock('./db/repositories/settingsRepository', () => ({
  getNotificationPreferences: () => ({
    enabled: true,
    verificationRequired: true,
    permissionRequired: true,
    jobFilled: true,
    jobFailed: true
  }),
  getNotificationLocale: () => 'en'
}))

import {
  clearPermissionRequestNotification,
  contentForJobUpdate,
  contentForPermissionRequest,
  contentForSearchVerification,
  contentForVerification,
  notifyForPermissionRequest,
  testNotificationContent
} from './notificationService'
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences } from '@shared/types/notification'
import type { AgentPermissionRequest } from '@shared/types/agentPermissions'
import type { JobRecord } from '@shared/types/job'

function job(status: JobRecord['status']): JobRecord {
  return {
    id: 'job-1',
    externalId: null,
    source: 'greenhouse',
    title: 'Platform Engineer',
    company: 'Acme',
    location: 'Remote',
    url: 'https://example.com/job',
    description: null,
    salaryRange: null,
    status,
    matchScore: null,
    matchReasons: null,
    applicationUrl: null,
    applyMethod: null,
    screenshotPath: null,
    screenshotPaths: [],
    failureTag: status === 'failed' ? 'form_not_supported' : null,
    failureMessage: null,
    blockingReason: null,
    blockingTaskId: null,
    queuedAt: '2020-01-01T00:00:00.000Z',
    filledAt: status === 'filled' ? '2020-01-01T01:00:00.000Z' : null,
    submittedAt: null,
    resumeVariantId: null,
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T01:00:00.000Z'
  }
}

function preferences(overrides: Partial<NotificationPreferences> = {}): NotificationPreferences {
  return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...overrides }
}

describe('notification content', () => {
  it('notifies for filled and failed jobs, but not ordinary queue updates', () => {
    expect(contentForJobUpdate(job('filled'), preferences())).toMatchObject({ title: 'Application ready for review' })
    expect(contentForJobUpdate(job('failed'), preferences())).toMatchObject({ title: 'Job could not be completed' })
    expect(contentForJobUpdate(job('queued'), preferences())).toBeNull()
    expect(contentForJobUpdate(job('submitted'), preferences())).toBeNull()
  })

  it('respects the master and per-category controls', () => {
    expect(contentForJobUpdate(job('filled'), preferences({ enabled: false }))).toBeNull()
    expect(contentForJobUpdate(job('filled'), preferences({ jobFilled: false }))).toBeNull()
    expect(contentForJobUpdate(job('failed'), preferences({ jobFailed: false }))).toBeNull()
    expect(
      contentForPermissionRequest(
        {
          requestId: 'request-1',
          jobId: 'job-1',
          jobTitle: 'Platform Engineer',
          company: 'Acme',
          permissions: ['autoUploadDocuments']
        },
        preferences({ permissionRequired: false })
      )
    ).toBeNull()
    expect(
      contentForVerification(
        { taskId: 'task-1', jobId: 'job-1', jobTitle: 'Platform Engineer', company: 'Acme' },
        preferences({ verificationRequired: false })
      )
    ).toBeNull()
  })

  it('includes useful job context in verification notifications', () => {
    expect(
      contentForVerification(
        { taskId: 'task-1', jobId: 'job-1', jobTitle: 'Platform Engineer', company: 'Acme' },
        preferences()
      )
    ).toEqual({
      title: 'Verification required',
      body: 'Platform Engineer at Acme needs your attention in the browser window.'
    })
  })

  it('names the site, not a job, when a search is waiting on a challenge', () => {
    expect(
      contentForSearchVerification({ taskId: 'search-1', source: 'prosple', host: 'au.prosple.com' }, preferences())
    ).toEqual({
      title: 'Verification required',
      body: 'Prosple (au.prosple.com) wants a verification challenge solved before it answers a job search. It is open in the browser window.'
    })
    expect(
      contentForSearchVerification({ taskId: 'search-1', source: 'prosple', host: 'au.prosple.com' }, preferences(), 'id')
    ).toEqual({
      title: 'Verifikasi diperlukan',
      body: 'Prosple (au.prosple.com) meminta tantangan verifikasi diselesaikan sebelum menjawab pencarian lowongan. Halamannya terbuka di jendela browser.'
    })
    // Shares the verification switch rather than having one of its own.
    expect(
      contentForSearchVerification(
        { taskId: 'search-1', source: 'prosple', host: 'au.prosple.com' },
        preferences({ verificationRequired: false })
      )
    ).toBeNull()
  })

  it('provides representative content for every settings-page test action', () => {
    expect(testNotificationContent('verificationRequired').title).toBe('Verification required')
    expect(testNotificationContent('permissionRequired').title).toBe('Agent permission required')
    expect(testNotificationContent('jobFilled').title).toBe('Application ready for review')
    expect(testNotificationContent('jobFailed').title).toBe('Job could not be completed')
  })

  it('includes job context but no profile data in permission notifications', () => {
    expect(
      contentForPermissionRequest(
        {
          requestId: 'request-1',
          jobId: 'job-1',
          jobTitle: 'Platform Engineer',
          company: 'Acme',
          permissions: ['autoUploadDocuments']
        },
        preferences()
      )
    ).toEqual({
      title: 'Agent permission required',
      body: 'The agent is waiting for permission to continue Platform Engineer at Acme.'
    })
  })

  it('uses the synchronized Indonesian locale for real and test notifications', () => {
    expect(
      contentForVerification(
        { taskId: 'task-1', jobId: 'job-1', jobTitle: 'Platform Engineer', company: 'Acme' },
        preferences(),
        'id'
      )
    ).toEqual({
      title: 'Verifikasi diperlukan',
      body: 'Platform Engineer di Acme perlu perhatianmu di jendela browser.'
    })
    expect(testNotificationContent('jobFilled', 'id')).toEqual({
      title: 'Lamaran siap diperiksa',
      body: 'Lowongan Tes di Perusahaan Contoh sudah diisi dan siap kamu periksa.'
    })
  })
})

describe('permission request delivery', () => {
  const request: AgentPermissionRequest = {
    requestId: 'request-1',
    jobId: 'job-1',
    jobTitle: 'Platform Engineer',
    company: 'Acme',
    permissions: ['autoUploadDocuments']
  }

  afterEach(() => {
    clearPermissionRequestNotification()
    vi.restoreAllMocks()
  })

  it('shows one notification while unfocused and closes it when the request resolves', () => {
    vi.spyOn(BrowserWindow, 'getAllWindows').mockReturnValue([
      {
        isDestroyed: () => false,
        isFocused: () => false
      } as Electron.BrowserWindow
    ])
    const show = vi.spyOn(Notification.prototype, 'show')
    const close = vi.spyOn(Notification.prototype, 'close')

    notifyForPermissionRequest(request)
    notifyForPermissionRequest(request)

    expect(show).toHaveBeenCalledTimes(1)
    clearPermissionRequestNotification()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('does not notify while the app is focused', () => {
    vi.spyOn(BrowserWindow, 'getAllWindows').mockReturnValue([
      {
        isDestroyed: () => false,
        isFocused: () => true
      } as Electron.BrowserWindow
    ])
    const show = vi.spyOn(Notification.prototype, 'show')

    notifyForPermissionRequest(request)

    expect(show).not.toHaveBeenCalled()
  })
})

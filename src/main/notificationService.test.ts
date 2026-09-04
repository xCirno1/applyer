import { describe, expect, it } from 'vitest'
import { contentForJobUpdate, contentForVerification, testNotificationContent } from './notificationService'
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences } from '@shared/types/notification'
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
    failureTag: status === 'failed' ? 'form_not_supported' : null,
    failureMessage: null,
    blockingReason: null,
    blockingTaskId: null,
    queuedAt: '2020-01-01T00:00:00.000Z',
    filledAt: status === 'filled' ? '2020-01-01T01:00:00.000Z' : null,
    submittedAt: null,
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

  it('provides representative content for every settings-page test action', () => {
    expect(testNotificationContent('verificationRequired').title).toBe('Verification required')
    expect(testNotificationContent('jobFilled').title).toBe('Application ready for review')
    expect(testNotificationContent('jobFailed').title).toBe('Job could not be completed')
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

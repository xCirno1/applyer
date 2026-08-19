import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../../db/testDb'
import { __resetElectronMock } from '../../../../test/mocks/electron'
import type * as schema from '../../db/schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../../db/index', () => ({ getDb: () => testDb }))

beforeEach(() => {
  testDb = createTestDb().db
  __resetElectronMock()
})

import { getProfileTool } from './getProfile'
import { saveProfile } from '../../db/repositories/profileRepository'
import { markOnboardingCompleted, setStorageMode } from '../../db/repositories/settingsRepository'
import { addDocument } from '../../db/repositories/documentsRepository'

const FULL_PROFILE = {
  fullName: 'Jane Doe',
  email: 'jane@example.com',
  phone: '',
  location: '',
  linkedinUrl: '',
  githubUrl: '',
  portfolioUrl: '',
  workAuthorization: '',
  desiredRoles: [],
  desiredLocations: [],
  remotePreference: 'no_preference' as const,
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: '',
  yearsExperience: null,
  summary: '',
  skills: []
}

describe('getProfileTool', () => {
  it('refuses to run before onboarding is completed, with an actionable error', async () => {
    const result = await getProfileTool()
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain('complete onboarding')
  })

  it('returns the profile and a trimmed document list once onboarding is complete', async () => {
    setStorageMode('plaintext')
    saveProfile(FULL_PROFILE)
    await addDocument({ kind: 'resume', originalFilename: 'resume.txt', mimeType: 'text/plain', data: Buffer.from('hi') })
    markOnboardingCompleted()

    const result = await getProfileTool()
    const body = JSON.parse((result.content[0] as { text: string }).text) as {
      profile: typeof FULL_PROFILE
      documents: { id: string; kind: string; filename: string; hasExtractedText: boolean }[]
    }
    expect(body.profile.fullName).toBe('Jane Doe')
    expect(body.documents).toHaveLength(1)
    expect(body.documents[0]).toMatchObject({ kind: 'resume', filename: 'resume.txt', hasExtractedText: true })
    // Tool response should not leak internal storage paths.
    expect(body.documents[0]).not.toHaveProperty('storedPath')
  })
})

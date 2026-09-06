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
    // Text costs context, so it is opt-in rather than included by default.
    expect(body.documents[0]).not.toHaveProperty('text')
  })

  it('includes each document\'s extracted text when asked for it', async () => {
    // This is what makes "upload your resume and let the agent fill in your
    // profile" work without the user knowing where the file lives on disk.
    setStorageMode('plaintext')
    saveProfile(FULL_PROFILE)
    await addDocument({
      kind: 'resume',
      originalFilename: 'resume.txt',
      mimeType: 'text/plain',
      data: Buffer.from('Jane Doe. Staff engineer. TypeScript, Go.')
    })
    markOnboardingCompleted()

    const result = await getProfileTool({ includeDocumentText: true })
    const body = JSON.parse((result.content[0] as { text: string }).text) as {
      documents: { text?: string; textTruncated?: boolean }[]
    }
    expect(body.documents[0]!.text).toContain('Staff engineer')
    expect(body.documents[0]!.textTruncated).toBe(false)
  })

  it('truncates a document far longer than a resume, and says that it did', async () => {
    setStorageMode('plaintext')
    saveProfile(FULL_PROFILE)
    await addDocument({
      kind: 'other',
      originalFilename: 'book.txt',
      mimeType: 'text/plain',
      data: Buffer.from('x'.repeat(25_000))
    })
    markOnboardingCompleted()

    const result = await getProfileTool({ includeDocumentText: true })
    const body = JSON.parse((result.content[0] as { text: string }).text) as {
      documents: { text?: string; textTruncated?: boolean }[]
    }
    expect(body.documents[0]!.text).toHaveLength(20_000)
    expect(body.documents[0]!.textTruncated).toBe(true)
  })

  it('leaves out the text field for a document nothing could be extracted from', async () => {
    setStorageMode('plaintext')
    saveProfile(FULL_PROFILE)
    await addDocument({
      kind: 'resume',
      originalFilename: 'scan.pdf',
      // An unsupported type extracts to null rather than throwing, which is
      // the same shape as a scanned PDF with no text layer.
      mimeType: 'image/png',
      data: Buffer.from([1, 2, 3])
    })
    markOnboardingCompleted()

    const result = await getProfileTool({ includeDocumentText: true })
    const body = JSON.parse((result.content[0] as { text: string }).text) as {
      documents: { hasExtractedText: boolean; text?: string }[]
    }
    expect(body.documents[0]!.hasExtractedText).toBe(false)
    expect(body.documents[0]).not.toHaveProperty('text')
  })
})

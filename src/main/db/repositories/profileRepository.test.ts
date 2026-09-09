import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../testDb'
import { __resetElectronMock } from '../../../../test/mocks/electron'
import type * as schema from '../schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../index', () => ({ getDb: () => testDb }))

beforeEach(() => {
  testDb = createTestDb().db
  __resetElectronMock()
})

import { getProfile, saveProfile, hasProfile } from './profileRepository'
import { setStorageMode } from './settingsRepository'
import { profile as profileTable } from '../schema'
import { writeSecureField } from '../encryption'
import type { ProfileFields } from '@shared/types/profile'

function profile(overrides: Partial<ProfileFields> = {}): ProfileFields {
  return {
    fullName: 'Jane Doe',
    email: 'jane@example.com',
    phone: '555-1234',
    location: 'Austin, TX',
    linkedinUrl: 'https://linkedin.com/in/jane',
    githubUrl: 'https://github.com/jane',
    portfolioUrl: '',
    workAuthorization: 'US Citizen',
    desiredRoles: ['Backend Engineer'],
    desiredLocations: ['Remote'],
    remotePreference: 'remote',
    salaryMin: 120000,
    salaryMax: 160000,
    salaryCurrency: 'USD',
    yearsExperience: 5,
    summary: 'Experienced backend engineer.',
    skills: ['TypeScript', 'Node.js'],
    additionalInformation: [],
    ...overrides
  }
}

describe('hasProfile / getProfile before any save', () => {
  it('reports no profile and returns null', () => {
    expect(hasProfile()).toBe(false)
    expect(getProfile()).toBeNull()
  })
})

describe('saveProfile / getProfile round trip', () => {
  it('round-trips all fields in encrypted mode', () => {
    setStorageMode('encrypted')
    saveProfile(profile())
    expect(hasProfile()).toBe(true)
    expect(getProfile()).toEqual(profile())
  })

  it('round-trips all fields in plaintext mode', () => {
    setStorageMode('plaintext')
    saveProfile(profile())
    expect(getProfile()).toEqual(profile())
  })

  it('reads an encrypted profile saved before additional information existed', () => {
    setStorageMode('encrypted')
    const legacyProfile: Record<string, unknown> = { ...profile() }
    delete legacyProfile.additionalInformation
    testDb
      .insert(profileTable)
      .values({ id: 1, securePayload: writeSecureField(JSON.stringify(legacyProfile), 'encrypted') })
      .run()

    expect(getProfile()).toEqual(profile({ additionalInformation: [] }))
  })

  it('defaults to encrypted mode ("fails closed") when no storage mode has been chosen yet', () => {
    saveProfile(profile({ email: 'secret@example.com' }))
    // Verify the raw DB row went through the encrypted-field path, i.e. it's
    // not plaintext on disk despite no explicit setStorageMode call.
    const raw = testDb.select().from(profileTable).get()
    expect(raw?.securePayload?.startsWith('enc:v1:')).toBe(true)
    expect(JSON.stringify(raw)).not.toContain('secret@example.com')
    // But reads back correctly through the repository regardless.
    expect(getProfile()?.email).toBe('secret@example.com')
  })

  it('leaves no profile field plaintext in the raw encrypted row', () => {
    setStorageMode('encrypted')
    saveProfile(profile())
    const raw = testDb.select().from(profileTable).get()
    const serialized = JSON.stringify(raw)
    for (const secret of ['Jane Doe', 'jane@example.com', 'linkedin.com/in/jane', 'US Citizen', 'Backend Engineer', '120000', 'TypeScript']) {
      expect(serialized).not.toContain(secret)
    }
    expect(raw?.securePayload).toMatch(/^enc:v1:/)
  })

  it.each([
    ['malformed JSON', '{not-json'],
    ['an invalid profile shape', JSON.stringify({ fullName: 42 })]
  ])('rejects %s in the encrypted profile envelope', (_case, serialized) => {
    testDb
      .insert(profileTable)
      .values({ id: 1, securePayload: writeSecureField(serialized, 'encrypted') })
      .run()

    expect(() => getProfile()).toThrow('The stored profile payload is invalid or corrupted.')
  })

  it('upserts on a second save rather than creating a second row', () => {
    saveProfile(profile({ fullName: 'First Save' }))
    saveProfile(profile({ fullName: 'Second Save' }))
    expect(getProfile()?.fullName).toBe('Second Save')
  })

  it('treats empty optional string fields as null on write but empty string on read', () => {
    saveProfile(profile({ linkedinUrl: '', githubUrl: '', portfolioUrl: '', workAuthorization: '', salaryCurrency: '' }))
    const read = getProfile()!
    expect(read.linkedinUrl).toBe('')
    expect(read.githubUrl).toBe('')
  })

  it('preserves null salary/years fields distinctly from 0', () => {
    saveProfile(profile({ salaryMin: null, salaryMax: null, yearsExperience: null }))
    const read = getProfile()!
    expect(read.salaryMin).toBeNull()
    expect(read.yearsExperience).toBeNull()

    saveProfile(profile({ salaryMin: 0, yearsExperience: 0 }))
    const read2 = getProfile()!
    expect(read2.salaryMin).toBe(0)
    expect(read2.yearsExperience).toBe(0)
  })
})

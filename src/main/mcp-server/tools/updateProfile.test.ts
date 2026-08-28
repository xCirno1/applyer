import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../../db/testDb'
import { __resetElectronMock } from '../../../../test/mocks/electron'
import type * as schema from '../../db/schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../../db/index', () => ({ getDb: () => testDb }))

const broadcastProfileChanged = vi.fn()
vi.mock('../../ipc/jobsBroadcast', () => ({
  broadcastProfileChanged: (): void => broadcastProfileChanged()
}))

beforeEach(() => {
  testDb = createTestDb().db
  __resetElectronMock()
  broadcastProfileChanged.mockClear()
})

import { updateProfileTool } from './updateProfile'
import { getProfile, saveProfile } from '../../db/repositories/profileRepository'
import { markOnboardingCompleted, setStorageMode } from '../../db/repositories/settingsRepository'
import { listActivity } from '../../db/repositories/activityLogRepository'
import type { ProfileFields } from '@shared/types/profile'

const BASE_PROFILE: ProfileFields = {
  fullName: 'Jane Doe',
  email: 'jane@example.com',
  phone: '+1 555 0100',
  location: 'Berlin',
  linkedinUrl: '',
  githubUrl: '',
  portfolioUrl: '',
  workAuthorization: '',
  desiredRoles: ['Backend Engineer'],
  desiredLocations: [],
  remotePreference: 'remote',
  salaryMin: 90_000,
  salaryMax: 120_000,
  salaryCurrency: 'EUR',
  yearsExperience: 6,
  summary: 'Backend engineer.',
  skills: ['Go']
}

/** The MCP SDK hands the handler a parsed object; these tests call it the same way. */
type ToolArgs = Parameters<typeof updateProfileTool>[0]
const call = (args: Partial<ToolArgs>): ReturnType<typeof updateProfileTool> =>
  updateProfileTool(args as ToolArgs)

function textOf(result: Awaited<ReturnType<typeof updateProfileTool>>): string {
  return (result.content[0] as { text: string }).text
}

function bodyOf(result: Awaited<ReturnType<typeof updateProfileTool>>): {
  status: string
  updatedFields: string[]
  profile: ProfileFields
} {
  return JSON.parse(textOf(result))
}

function seedProfile(overrides: Partial<ProfileFields> = {}): void {
  setStorageMode('plaintext')
  saveProfile({ ...BASE_PROFILE, ...overrides })
  markOnboardingCompleted()
}

describe('updateProfileTool', () => {
  it('refuses to run before onboarding is completed, with an actionable error', async () => {
    const result = await call({ summary: 'x' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('complete onboarding')
    expect(getProfile()).toBeNull()
  })

  it('rejects a call with no fields rather than writing an empty profile', async () => {
    seedProfile()
    const result = await call({})
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('No fields given')
    expect(getProfile()?.fullName).toBe('Jane Doe')
  })

  it('writes only the fields passed and leaves the rest untouched', async () => {
    seedProfile()

    const result = await call({ skills: ['Go', 'Kubernetes'], yearsExperience: 8 })

    const body = bodyOf(result)
    expect(result.isError).toBeUndefined()
    expect(body.status).toBe('updated')
    expect(body.updatedFields.sort()).toEqual(['skills', 'yearsExperience'])

    const stored = getProfile()!
    expect(stored.skills).toEqual(['Go', 'Kubernetes'])
    expect(stored.yearsExperience).toBe(8)
    // Untouched fields survive — the whole point of merging rather than replacing.
    expect(stored.salaryMin).toBe(90_000)
    expect(stored.desiredRoles).toEqual(['Backend Engineer'])
    expect(stored.summary).toBe('Backend engineer.')
  })

  it('treats a list field as a replacement, not an append', async () => {
    seedProfile()
    await call({ skills: ['Rust'] })
    expect(getProfile()?.skills).toEqual(['Rust'])
  })

  it('drops blank and case-insensitively duplicated list entries', async () => {
    seedProfile()
    await call({ skills: ['Go', 'go', ' ', 'GO ', 'Rust'] })
    expect(getProfile()?.skills).toEqual(['Go', 'Rust'])
  })

  it('clears a nullable numeric field when passed null', async () => {
    seedProfile()
    const body = bodyOf(await call({ salaryMin: null, salaryMax: null }))
    expect(body.updatedFields.sort()).toEqual(['salaryMax', 'salaryMin'])
    expect(getProfile()?.salaryMin).toBeNull()
  })

  it('reports unchanged (and writes nothing) when every field already has that value', async () => {
    seedProfile()
    const result = await call({ skills: ['Go'], yearsExperience: 6 })

    const body = bodyOf(result)
    expect(body.status).toBe('unchanged')
    expect(body.updatedFields).toEqual([])
    expect(broadcastProfileChanged).not.toHaveBeenCalled()
  })

  it('refuses to clear a name or email the user had already filled in', async () => {
    seedProfile()
    const result = await call({ fullName: '', email: '' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('fullName and email')
    expect(getProfile()?.fullName).toBe('Jane Doe')
  })

  it('allows setting a name and email that were empty to begin with', async () => {
    seedProfile({ fullName: '', email: '' })
    const result = await call({ fullName: 'Jane Doe', email: 'jane@example.com' })
    expect(result.isError).toBeUndefined()
    expect(getProfile()?.email).toBe('jane@example.com')
  })

  it('refuses an inverted salary range, including one formed against a stored value', async () => {
    seedProfile()
    const result = await call({ salaryMax: 50_000 })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('inverted salary range')
    expect(getProfile()?.salaryMax).toBe(120_000)
  })

  it('lets an unrelated update through when the stored salary range is already inverted', async () => {
    // Settings validates the two bounds independently, so this profile is
    // reachable without the agent ever being involved.
    seedProfile({ salaryMin: 120_000, salaryMax: 90_000 })

    const result = await call({ skills: ['Go', 'Rust'] })

    expect(result.isError).toBeUndefined()
    expect(getProfile()?.skills).toEqual(['Go', 'Rust'])
    // Left exactly as it was, rather than being "fixed" or wiped in passing.
    expect(getProfile()?.salaryMin).toBe(120_000)
    expect(getProfile()?.salaryMax).toBe(90_000)
  })

  it('still refuses a salary edit that leaves the stored range inverted', async () => {
    seedProfile({ salaryMin: 120_000, salaryMax: 90_000 })
    const result = await call({ salaryMax: 80_000 })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('inverted salary range')
    expect(getProfile()?.salaryMax).toBe(90_000)
  })

  it('merges onto an empty profile when no profile row exists yet', async () => {
    setStorageMode('plaintext')
    markOnboardingCompleted()

    const result = await call({ fullName: 'New Person', summary: 'Just onboarded.' })

    expect(result.isError).toBeUndefined()
    const stored = getProfile()!
    expect(stored.fullName).toBe('New Person')
    expect(stored.skills).toEqual([])
    expect(stored.remotePreference).toBe('no_preference')
  })

  it('notifies the renderer and logs which fields the agent touched', async () => {
    seedProfile()
    await call({ summary: 'Rewritten from resume.' })

    expect(broadcastProfileChanged).toHaveBeenCalledTimes(1)
    const entries = listActivity({ limit: 10, offset: 0 }).entries
    expect(entries.some((e) => e.message.includes('Agent updated profile: summary'))).toBe(true)
  })

  it('round-trips through encrypted storage rather than depending on plaintext mode', async () => {
    setStorageMode('encrypted')
    saveProfile(BASE_PROFILE)
    markOnboardingCompleted()

    await call({ location: 'Amsterdam' })

    expect(getProfile()?.location).toBe('Amsterdam')
    expect(getProfile()?.fullName).toBe('Jane Doe')
  })
})

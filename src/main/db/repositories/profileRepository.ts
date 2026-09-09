import { eq } from 'drizzle-orm'
import { getDb } from '../index'
import { profile } from '../schema'
import { readSecureField, writeSecureField } from '../encryption'
import { getStorageMode } from './settingsRepository'
import { normalizeProfileFields, type ProfileFields } from '@shared/types/profile'

const PROFILE_ID = 1

/** All candidate fields are serialized into one encrypted envelope. */
const SECURE_FIELDS = [
  'fullName',
  'email',
  'phone',
  'location',
  'linkedinUrl',
  'githubUrl',
  'portfolioUrl',
  'workAuthorization',
  'desiredRoles',
  'desiredLocations',
  'remotePreference',
  'salaryMin',
  'salaryMax',
  'salaryCurrency',
  'yearsExperience',
  'summary',
  'skills',
  'additionalInformation'
] as const

export function getProfile(): ProfileFields | null {
  const row = getDb().select().from(profile).where(eq(profile.id, PROFILE_ID)).get()
  if (!row) return null

  if (row.securePayload) {
    const serialized = readSecureField(row.securePayload)
    if (!serialized) throw new Error('The encrypted profile payload was empty.')
    let parsed: unknown
    try {
      parsed = JSON.parse(serialized)
    } catch {
      throw new Error('The stored profile payload is invalid or corrupted.')
    }
    const normalized = normalizeProfileFields(parsed)
    if (!normalized) {
      throw new Error('The stored profile payload is invalid or corrupted.')
    }
    return normalized
  }

  // Legacy rows are read long enough to be re-saved into the envelope by a
  // profile edit or storage-mode migration.
  return {
    fullName: readSecureField(row.fullName) ?? '',
    email: readSecureField(row.email) ?? '',
    phone: readSecureField(row.phone) ?? '',
    location: readSecureField(row.location) ?? '',
    linkedinUrl: row.linkedinUrl ?? '',
    githubUrl: row.githubUrl ?? '',
    portfolioUrl: row.portfolioUrl ?? '',
    workAuthorization: row.workAuthorization ?? '',
    desiredRoles: row.desiredRoles ?? [],
    desiredLocations: row.desiredLocations ?? [],
    remotePreference: row.remotePreference ?? 'no_preference',
    salaryMin: row.salaryMin,
    salaryMax: row.salaryMax,
    salaryCurrency: row.salaryCurrency ?? '',
    yearsExperience: row.yearsExperience,
    summary: readSecureField(row.summary) ?? '',
    skills: row.skills ?? [],
    additionalInformation: []
  }
}

export function saveProfile(fields: ProfileFields): void {
  const db = getDb()
  // Fails closed: if a storage mode was somehow never chosen, default to the
  // more protective option rather than silently writing plaintext.
  const mode = getStorageMode() ?? 'encrypted'
  const now = new Date().toISOString()

  const values = {
    id: PROFILE_ID,
    // Clear every legacy content column so encrypted mode does not leave a
    // second plaintext copy alongside the new complete envelope.
    fullName: null,
    email: null,
    phone: null,
    location: null,
    linkedinUrl: null,
    githubUrl: null,
    portfolioUrl: null,
    workAuthorization: null,
    desiredRoles: null,
    desiredLocations: null,
    remotePreference: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    yearsExperience: null,
    summary: null,
    skills: null,
    securePayload: writeSecureField(JSON.stringify(fields), mode),
    updatedAt: now
  }

  db.insert(profile)
    .values(values)
    .onConflictDoUpdate({ target: profile.id, set: values })
    .run()
}

export function hasProfile(): boolean {
  return getDb().select({ id: profile.id }).from(profile).where(eq(profile.id, PROFILE_ID)).get() !== undefined
}

export { SECURE_FIELDS, PROFILE_ID }

import { eq } from 'drizzle-orm'
import { getDb } from '../index'
import { profile } from '../schema'
import { readSecureField, writeSecureField } from '../encryption'
import { getStorageMode } from './settingsRepository'
import type { ProfileFields } from '@shared/types/profile'

const PROFILE_ID = 1

/** Text columns that may hold sensitive PII and go through the storage-mode encryption path. */
const SECURE_FIELDS = ['fullName', 'email', 'phone', 'location', 'summary'] as const

export function getProfile(): ProfileFields | null {
  const row = getDb().select().from(profile).where(eq(profile.id, PROFILE_ID)).get()
  if (!row) return null

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
    skills: row.skills ?? []
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
    fullName: writeSecureField(fields.fullName, mode),
    email: writeSecureField(fields.email, mode),
    phone: writeSecureField(fields.phone, mode),
    location: writeSecureField(fields.location, mode),
    linkedinUrl: fields.linkedinUrl || null,
    githubUrl: fields.githubUrl || null,
    portfolioUrl: fields.portfolioUrl || null,
    workAuthorization: fields.workAuthorization || null,
    desiredRoles: fields.desiredRoles,
    desiredLocations: fields.desiredLocations,
    remotePreference: fields.remotePreference,
    salaryMin: fields.salaryMin,
    salaryMax: fields.salaryMax,
    salaryCurrency: fields.salaryCurrency || null,
    yearsExperience: fields.yearsExperience,
    summary: writeSecureField(fields.summary, mode),
    skills: fields.skills,
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

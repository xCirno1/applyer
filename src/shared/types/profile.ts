export type RemotePreference = 'remote' | 'hybrid' | 'onsite' | 'no_preference'

export type StorageMode = 'encrypted' | 'plaintext'

export type DocumentKind = 'resume' | 'cover_letter' | 'other'

export interface ProfileFields {
  fullName: string
  email: string
  phone: string
  location: string
  linkedinUrl: string
  githubUrl: string
  portfolioUrl: string
  workAuthorization: string
  desiredRoles: string[]
  desiredLocations: string[]
  remotePreference: RemotePreference
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string
  yearsExperience: number | null
  summary: string
  skills: string[]
}

const REMOTE_PREFERENCES: readonly RemotePreference[] = [
  'remote',
  'hybrid',
  'onsite',
  'no_preference'
]

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

/** Validates profile data after it crosses a storage or IPC boundary. */
export function isProfileFields(value: unknown): value is ProfileFields {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>

  return (
    typeof candidate.fullName === 'string' &&
    typeof candidate.email === 'string' &&
    typeof candidate.phone === 'string' &&
    typeof candidate.location === 'string' &&
    typeof candidate.linkedinUrl === 'string' &&
    typeof candidate.githubUrl === 'string' &&
    typeof candidate.portfolioUrl === 'string' &&
    typeof candidate.workAuthorization === 'string' &&
    isStringArray(candidate.desiredRoles) &&
    isStringArray(candidate.desiredLocations) &&
    typeof candidate.remotePreference === 'string' &&
    REMOTE_PREFERENCES.includes(candidate.remotePreference as RemotePreference) &&
    isNullableFiniteNumber(candidate.salaryMin) &&
    isNullableFiniteNumber(candidate.salaryMax) &&
    typeof candidate.salaryCurrency === 'string' &&
    isNullableFiniteNumber(candidate.yearsExperience) &&
    typeof candidate.summary === 'string' &&
    isStringArray(candidate.skills)
  )
}

export interface DocumentSummary {
  id: string
  kind: DocumentKind
  originalFilename: string
  sizeBytes: number
  hasExtractedText: boolean
  createdAt: string
}

export interface ProfileWithDocuments {
  profile: ProfileFields | null
  documents: DocumentSummary[]
}

/**
 * The all-empty profile. Canonical here rather than in the renderer store
 * because both sides need it: the store falls back to it before the first
 * fetch, and `update_profile` merges the agent's partial update onto it
 * when no profile row exists yet.
 */
export const EMPTY_PROFILE: ProfileFields = {
  fullName: '',
  email: '',
  phone: '',
  location: '',
  linkedinUrl: '',
  githubUrl: '',
  portfolioUrl: '',
  workAuthorization: '',
  desiredRoles: [],
  desiredLocations: [],
  remotePreference: 'no_preference',
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: 'USD',
  yearsExperience: null,
  summary: '',
  skills: []
}

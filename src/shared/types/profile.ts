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

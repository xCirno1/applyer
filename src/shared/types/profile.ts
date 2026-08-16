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

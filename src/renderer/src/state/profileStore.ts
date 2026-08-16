import { create } from 'zustand'
import type { DocumentSummary, ProfileFields } from '@shared/types/profile'
import type { UploadDocumentRequest } from '@shared/types/ipcEvents'

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

interface ProfileState {
  profile: ProfileFields
  documents: DocumentSummary[]
  loading: boolean
  loaded: boolean
  fetch: () => Promise<void>
  save: (fields: ProfileFields) => Promise<{ ok: boolean; error?: string }>
  uploadDocument: (request: UploadDocumentRequest) => Promise<{ ok: boolean; error?: string }>
  deleteDocument: (documentId: string) => Promise<void>
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profile: EMPTY_PROFILE,
  documents: [],
  loading: false,
  loaded: false,

  fetch: async () => {
    set({ loading: true })
    const result = await window.api.profile.get()
    set({
      profile: result.profile ?? EMPTY_PROFILE,
      documents: result.documents,
      loading: false,
      loaded: true
    })
  },

  save: async (fields) => {
    const result = await window.api.profile.save(fields)
    if (result.ok) {
      set({ profile: fields })
    }
    return result
  },

  uploadDocument: async (request) => {
    const result = await window.api.profile.uploadDocument(request)
    if (result.ok && result.document) {
      set({ documents: [...get().documents, result.document] })
    }
    return result
  },

  deleteDocument: async (documentId) => {
    await window.api.profile.deleteDocument(documentId)
    set({ documents: get().documents.filter((d) => d.id !== documentId) })
  }
}))

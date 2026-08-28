import { create } from 'zustand'
import { EMPTY_PROFILE, type DocumentSummary, type ProfileFields } from '@shared/types/profile'
import type { UploadDocumentRequest } from '@shared/types/ipcEvents'

export { EMPTY_PROFILE }

interface ProfileState {
  profile: ProfileFields
  documents: DocumentSummary[]
  loading: boolean
  loaded: boolean
  fetch: () => Promise<void>
  save: (fields: ProfileFields) => Promise<{ ok: boolean; error?: string }>
  uploadDocument: (request: UploadDocumentRequest) => Promise<{ ok: boolean; error?: string }>
  deleteDocument: (documentId: string) => Promise<void>
  subscribeToUpdates: () => () => void
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

  /**
   * The profile row has two writers — the Settings form and the agent's
   * update_profile tool — so the store has to hear about the other one. Wired
   * up from App's MainShell rather than from the Settings form: that form is
   * only mounted while its own section is showing, and a change landing while
   * it is closed would leave `loaded` true, so the next mount would seed the
   * draft from a stale profile and write it straight back on Save.
   */
  subscribeToUpdates: () => window.api.profile.onChanged(() => void get().fetch()),

  deleteDocument: async (documentId) => {
    await window.api.profile.deleteDocument(documentId)
    set({ documents: get().documents.filter((d) => d.id !== documentId) })
  }
}))

import { create } from 'zustand'
import { callIpc } from '../lib/ipcCall'
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
    // `profile.get` is the one read in the app that throws by design: the
    // fields go through `readSecureField`, which refuses to guess when the OS
    // keyring is unavailable. Unhandled, that rejection skipped the `set`
    // below and left the profile form loading forever.
    const result = await callIpc('profile.get', () => window.api.profile.get(), {
      profile: null,
      documents: []
    })
    set({
      profile: result.profile ?? EMPTY_PROFILE,
      documents: result.documents,
      loading: false,
      loaded: true
    })
  },

  save: async (fields) => {
    // The failure shape the caller already handles, so a bridge failure
    // surfaces as the same toast a refused save does.
    const result = await callIpc('profile.save', () => window.api.profile.save(fields), { ok: false })
    if (result.ok) {
      set({ profile: fields })
    }
    return result
  },

  uploadDocument: async (request) => {
    const result = await callIpc(
      'profile.uploadDocument',
      () => window.api.profile.uploadDocument(request),
      { ok: false }
    )
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
    const result = await callIpc(
      'profile.deleteDocument',
      () => window.api.profile.deleteDocument(documentId),
      { ok: false }
    )
    // The row stays if the delete did not happen — dropping it locally would
    // show the document gone until the next fetch brought it back.
    if (result.ok) set({ documents: get().documents.filter((d) => d.id !== documentId) })
  }
}))

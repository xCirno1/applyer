// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DocumentSummary, ProfileFields } from '@shared/types/profile'

const getMock = vi.fn()
const saveMock = vi.fn()
const uploadDocumentMock = vi.fn()
const deleteDocumentMock = vi.fn()
let onChangedHandlers: (() => void)[] = []

beforeEach(() => {
  vi.resetModules()
  getMock.mockReset()
  saveMock.mockReset()
  uploadDocumentMock.mockReset()
  deleteDocumentMock.mockReset()
  onChangedHandlers = []
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      profile: {
        get: getMock,
        save: saveMock,
        uploadDocument: uploadDocumentMock,
        deleteDocument: deleteDocumentMock,
        onChanged: (callback: () => void) => {
          onChangedHandlers.push(callback)
          return () => {
            onChangedHandlers = onChangedHandlers.filter((h) => h !== callback)
          }
        }
      }
    }
  })
})

function profile(overrides: Partial<ProfileFields> = {}): ProfileFields {
  return {
    fullName: 'Jane Doe',
    email: 'jane@example.com',
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
    skills: [],
    ...overrides
  }
}

function doc(overrides: Partial<DocumentSummary> = {}): DocumentSummary {
  return { id: 'doc-1', kind: 'resume', originalFilename: 'resume.pdf', sizeBytes: 100, hasExtractedText: true, createdAt: '2026-01-01T00:00:00.000Z', ...overrides }
}

describe('profileStore', () => {
  it('starts with the empty profile before fetch resolves', async () => {
    const { useProfileStore, EMPTY_PROFILE } = await import('./profileStore')
    expect(useProfileStore.getState().profile).toEqual(EMPTY_PROFILE)
    expect(useProfileStore.getState().loaded).toBe(false)
  })

  it('fetch loads the profile and documents, and flips loading/loaded', async () => {
    const { useProfileStore } = await import('./profileStore')
    getMock.mockResolvedValue({ profile: profile({ fullName: 'Jane' }), documents: [doc()] })

    const promise = useProfileStore.getState().fetch()
    expect(useProfileStore.getState().loading).toBe(true)
    await promise

    const state = useProfileStore.getState()
    expect(state.profile.fullName).toBe('Jane')
    expect(state.documents).toHaveLength(1)
    expect(state.loading).toBe(false)
    expect(state.loaded).toBe(true)
  })

  it('fetch falls back to the empty profile when none exists yet (onboarding)', async () => {
    const { useProfileStore, EMPTY_PROFILE } = await import('./profileStore')
    getMock.mockResolvedValue({ profile: null, documents: [] })

    await useProfileStore.getState().fetch()

    expect(useProfileStore.getState().profile).toEqual(EMPTY_PROFILE)
  })

  it('subscribeToUpdates refetches on a profile:changed push, and the returned cleanup unsubscribes', async () => {
    const { useProfileStore } = await import('./profileStore')
    getMock.mockResolvedValue({ profile: profile({ fullName: 'Written By Agent' }), documents: [] })

    const unsubscribe = useProfileStore.getState().subscribeToUpdates()
    expect(getMock).not.toHaveBeenCalled()

    onChangedHandlers[0]!()
    await vi.waitFor(() => expect(useProfileStore.getState().profile.fullName).toBe('Written By Agent'))

    unsubscribe()
    expect(onChangedHandlers).toEqual([])
  })

  it('save updates local state on success', async () => {
    const { useProfileStore } = await import('./profileStore')
    saveMock.mockResolvedValue({ ok: true })

    const result = await useProfileStore.getState().save(profile({ fullName: 'Updated Name' }))

    expect(result).toEqual({ ok: true })
    expect(useProfileStore.getState().profile.fullName).toBe('Updated Name')
  })

  it('save leaves local state untouched and surfaces the error on failure', async () => {
    const { useProfileStore, EMPTY_PROFILE } = await import('./profileStore')
    saveMock.mockResolvedValue({ ok: false, error: 'validation failed' })

    const result = await useProfileStore.getState().save(profile({ fullName: 'Should Not Stick' }))

    expect(result).toEqual({ ok: false, error: 'validation failed' })
    expect(useProfileStore.getState().profile).toEqual(EMPTY_PROFILE)
  })

  it('uploadDocument appends the new document on success', async () => {
    const { useProfileStore } = await import('./profileStore')
    uploadDocumentMock.mockResolvedValue({ ok: true, document: doc({ id: 'new-doc' }) })

    const result = await useProfileStore.getState().uploadDocument({
      kind: 'resume',
      filename: 'resume.pdf',
      mimeType: 'application/pdf',
      data: new ArrayBuffer(0)
    })

    expect(result.ok).toBe(true)
    expect(useProfileStore.getState().documents.map((d) => d.id)).toEqual(['new-doc'])
  })

  it('uploadDocument does not append anything on failure', async () => {
    const { useProfileStore } = await import('./profileStore')
    uploadDocumentMock.mockResolvedValue({ ok: false, error: 'too large' })

    const result = await useProfileStore.getState().uploadDocument({
      kind: 'resume',
      filename: 'resume.pdf',
      mimeType: 'application/pdf',
      data: new ArrayBuffer(0)
    })

    expect(result).toEqual({ ok: false, error: 'too large' })
    expect(useProfileStore.getState().documents).toEqual([])
  })

  it('deleteDocument removes only the targeted document', async () => {
    const { useProfileStore } = await import('./profileStore')
    getMock.mockResolvedValue({ profile: profile(), documents: [doc({ id: 'a' }), doc({ id: 'b' })] })
    await useProfileStore.getState().fetch()

    await useProfileStore.getState().deleteDocument('a')

    expect(useProfileStore.getState().documents.map((d) => d.id)).toEqual(['b'])
    expect(deleteDocumentMock).toHaveBeenCalledWith('a')
  })
})

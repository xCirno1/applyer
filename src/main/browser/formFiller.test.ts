import { describe, it, expect, vi } from 'vitest'
import type { Page } from 'playwright'
import { fillForm } from './formFiller'
import type { ProfileFields } from '@shared/types/profile'

const EMPTY_PROFILE: ProfileFields = {
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

interface FakeField {
  selector: string
  tag: 'input' | 'textarea'
  type: string
  label: string
}

type Spy = (selector: string, value: string, label: string | undefined) => Promise<void>

function fakePage(fields: FakeField[]): { page: Page; fillSpy: ReturnType<typeof vi.fn<Spy>>; uploadSpy: ReturnType<typeof vi.fn<Spy>> } {
  const fillSpy = vi.fn<Spy>(async () => {})
  const uploadSpy = vi.fn<Spy>(async () => {})

  const page = {
    evaluate: async () => fields,
    locator: (selector: string) => {
      const field = fields.find((f) => f.selector === selector)
      return {
        fill: async (value: string) => fillSpy(selector, value, field?.label),
        setInputFiles: async (path: string) => uploadSpy(selector, path, field?.label)
      }
    }
  } as unknown as Page

  return { page, fillSpy, uploadSpy }
}

function profile(overrides: Partial<ProfileFields> = {}): ProfileFields {
  return { ...EMPTY_PROFILE, ...overrides }
}

describe('fillForm', () => {
  it('fills standard fields matched by their label', async () => {
    const { page, fillSpy } = fakePage([
      { selector: '#email', tag: 'input', type: 'email', label: 'Email' },
      { selector: '#phone', tag: 'input', type: 'tel', label: 'Phone Number' }
    ])
    const result = await fillForm(page, profile({ email: 'jane@example.com', phone: '555-1234' }))

    expect(fillSpy).toHaveBeenCalledWith('#email', 'jane@example.com', 'Email')
    expect(fillSpy).toHaveBeenCalledWith('#phone', '555-1234', 'Phone Number')
    expect(result.filledFields).toEqual(expect.arrayContaining(['Email', 'Phone Number']))
    expect(result.skippedFields).toEqual([])
  })

  it('splits full name into first/last name fields when both are present', async () => {
    const { page, fillSpy } = fakePage([
      { selector: '#first', tag: 'input', type: 'text', label: 'First Name' },
      { selector: '#last', tag: 'input', type: 'text', label: 'Last Name' }
    ])
    await fillForm(page, profile({ fullName: 'Jane Q. Doe' }))

    expect(fillSpy).toHaveBeenCalledWith('#first', 'Jane', 'First Name')
    expect(fillSpy).toHaveBeenCalledWith('#last', 'Q. Doe', 'Last Name')
  })

  it('skips a field with no matching profile data, with a descriptive reason', async () => {
    const { page } = fakePage([{ selector: '#github', tag: 'input', type: 'text', label: 'GitHub' }])
    const result = await fillForm(page, profile({ githubUrl: '' }))
    expect(result.filledFields).toEqual([])
    expect(result.skippedFields).toEqual(['GitHub (no matching profile data)'])
  })

  it('does not fill an unrecognized custom field at all', async () => {
    const { page, fillSpy } = fakePage([
      { selector: '#essay', tag: 'textarea', type: 'text', label: 'Why do you want to work here?' }
    ])
    const result = await fillForm(page, profile())
    expect(fillSpy).not.toHaveBeenCalled()
    expect(result.filledFields).toEqual([])
    expect(result.skippedFields).toEqual([])
  })

  it('fills only the first of two fields matching the same category', async () => {
    const { page, fillSpy } = fakePage([
      { selector: '#email1', tag: 'input', type: 'email', label: 'Email' },
      { selector: '#email2', tag: 'input', type: 'email', label: 'Confirm Email' }
    ])
    const result = await fillForm(page, profile({ email: 'jane@example.com' }))
    expect(fillSpy).toHaveBeenCalledTimes(1)
    expect(fillSpy).toHaveBeenCalledWith('#email1', 'jane@example.com', 'Email')
    expect(result.filledFields).toEqual(['Email'])
  })

  it('uploads the resume file when a resume field and file path are both present', async () => {
    const { page, uploadSpy } = fakePage([{ selector: '#resume', tag: 'input', type: 'file', label: 'Resume/CV' }])
    const result = await fillForm(page, profile(), { resumeFilePath: '/tmp/resume.pdf' })
    expect(uploadSpy).toHaveBeenCalledWith('#resume', '/tmp/resume.pdf', 'Resume/CV')
    expect(result.filledFields).toEqual(['Resume/CV'])
  })

  it('skips a resume upload field when no resume is on file', async () => {
    const { page, uploadSpy } = fakePage([{ selector: '#resume', tag: 'input', type: 'file', label: 'Resume' }])
    const result = await fillForm(page, profile())
    expect(uploadSpy).not.toHaveBeenCalled()
    expect(result.skippedFields).toEqual(['Resume (no resume on file)'])
  })

  it('leaves a free-text cover letter textarea for the human, with an explanatory skip reason', async () => {
    const { page, fillSpy } = fakePage([{ selector: '#cl', tag: 'textarea', type: 'text', label: 'Cover Letter' }])
    const result = await fillForm(page, profile())
    expect(fillSpy).not.toHaveBeenCalled()
    expect(result.skippedFields).toEqual(['Cover Letter (free-text cover letter, left for you)'])
  })

  it('records a skip (not a thrown error) when filling a field throws', async () => {
    const fields: FakeField[] = [{ selector: '#email', tag: 'input', type: 'email', label: 'Email' }]
    const page = {
      evaluate: async () => fields,
      locator: () => ({
        fill: async () => {
          throw new Error('element detached')
        }
      })
    } as unknown as Page

    const result = await fillForm(page, profile({ email: 'jane@example.com' }))
    expect(result.filledFields).toEqual([])
    expect(result.skippedFields).toEqual([expect.stringContaining('Email (failed: Error: element detached)')])
  })

  it('matches location before falling through to no match, distinguishing it from full name', async () => {
    const { page, fillSpy } = fakePage([{ selector: '#loc', tag: 'input', type: 'text', label: 'Current Location' }])
    await fillForm(page, profile({ location: 'Austin, TX' }))
    expect(fillSpy).toHaveBeenCalledWith('#loc', 'Austin, TX', 'Current Location')
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { Page } from 'playwright'
import { JSDOM } from 'jsdom'
import { fillForm, inspectAnswerRequirements, inspectApplicationFields } from './formFiller'

interface FakeField {
  fieldId: string
  selector?: string
  label: string
  name?: string
  placeholder?: string
  autocomplete?: string
  control: 'input' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'file'
  inputType?: string
  required: boolean
  currentValue: string | boolean | string[]
  options?: Array<{ label: string; value: string; selector?: string; checked?: boolean }>
}

function fakePage(fields: FakeField[]): { page: Page; calls: Record<string, ReturnType<typeof vi.fn>> } {
  const calls = { fill: vi.fn(), selectOption: vi.fn(), check: vi.fn(), uncheck: vi.fn(), setInputFiles: vi.fn() }
  return {
    page: {
      evaluate: vi.fn().mockResolvedValue(fields),
      locator: vi.fn().mockImplementation((selector: string) => ({
        fill: (value: string) => calls.fill(selector, value),
        selectOption: (value: string | string[]) => calls.selectOption(selector, value),
        check: () => calls.check(selector),
        uncheck: () => calls.uncheck(selector),
        setInputFiles: (value: string) => calls.setInputFiles(selector, value)
      }))
    } as unknown as Page,
    calls
  }
}

function domPage(html: string): { page: Page; document: Document } {
  const dom = new JSDOM(html)
  const page = {
    evaluate: vi.fn().mockImplementation(async (callback: () => unknown) => {
      const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
      const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
      const previousCss = Object.getOwnPropertyDescriptor(globalThis, 'CSS')
      Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window })
      Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document })
      Object.defineProperty(globalThis, 'CSS', { configurable: true, value: { escape: (value: string) => value } })
      try {
        return callback()
      } finally {
        if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
        else delete (globalThis as { window?: unknown }).window
        if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
        else delete (globalThis as { document?: unknown }).document
        if (previousCss) Object.defineProperty(globalThis, 'CSS', previousCss)
        else delete (globalThis as { CSS?: unknown }).CSS
      }
    })
  } as unknown as Page
  return { page, document: dom.window.document }
}

describe('inspectApplicationFields', () => {
  it('returns neutral field semantics and choices without browser selectors', async () => {
    const { page } = fakePage([{ fieldId: 'field-custom', selector: '#custom', label: 'Are you legally permitted to work here?', name: 'work_auth', autocomplete: 'off', control: 'select', required: true, currentValue: '', options: [{ label: 'Choose', value: '', selector: '#detail' }, { label: 'Yes', value: 'yes', selector: '#detail' }] }])
    await expect(inspectApplicationFields(page)).resolves.toEqual([{
      fieldId: 'field-custom',
      label: 'Are you legally permitted to work here?', name: 'work_auth', autocomplete: 'off', control: 'select', required: true, currentValue: '',
      options: [{ label: 'Choose', value: '' }, { label: 'Yes', value: 'yes' }]
    }])
  })

  it('omits password controls instead of exposing their current value', async () => {
    const { page } = domPage(`
      <label for="email">Email</label><input id="email" type="email" value="jane@example.com">
      <label for="password">Password</label><input id="password" type="password" value="secret-value">
    `)

    const fields = await inspectApplicationFields(page)

    expect(fields.map((field) => field.label)).toEqual(['Email'])
    expect(JSON.stringify(fields)).not.toContain('secret-value')
  })

  it('keeps an ID for value-only changes and replaces it when the control meaning changes', async () => {
    const { page, document } = domPage('<label for="answer">Email</label><input id="answer" name="email" value="old@example.com">')
    const first = (await inspectApplicationFields(page))[0]!

    const input = document.getElementById('answer') as HTMLInputElement
    input.value = 'new@example.com'
    const valueChanged = (await inspectApplicationFields(page))[0]!
    expect(valueChanged.fieldId).toBe(first.fieldId)

    document.querySelector('label')!.textContent = 'Phone'
    input.name = 'phone'
    const repurposed = (await inspectApplicationFields(page))[0]!
    expect(repurposed.fieldId).not.toBe(first.fieldId)
  })

  it('returns a scalar current value for a radio group', async () => {
    const { page } = domPage(`
      <fieldset>
        <legend>Work authorization</legend>
        <label><input type="radio" name="authorized" value="yes" checked>Yes</label>
        <label><input type="radio" name="authorized" value="no">No</label>
      </fieldset>
    `)

    const fields = await inspectApplicationFields(page)

    expect(fields).toHaveLength(1)
    expect(fields[0]).toMatchObject({ control: 'radio', currentValue: 'yes' })
  })
})

describe('fillForm', () => {
  it('fills only the opaque field ID explicitly selected by the agent', async () => {
    const { page, calls } = fakePage([
      { fieldId: 'field-name', selector: '#name', label: 'Your preferred display name', control: 'input', inputType: 'text', required: true, currentValue: '' },
      { fieldId: 'field-email', selector: '#email', label: 'Where should we contact you?', control: 'input', inputType: 'email', required: true, currentValue: '' }
    ])
    const result = await fillForm(page, [{ fieldId: 'field-email', value: 'jane@example.com' }], { allowFieldCompletion: true, allowDocumentUploads: false })
    expect(calls.fill).toHaveBeenCalledOnce()
    expect(calls.fill).toHaveBeenCalledWith('#email', 'jane@example.com')
    expect(result.filledFields).toEqual(['Where should we contact you?'])
  })

  it('does not use a semantic label as a field identity', async () => {
    const { page, calls } = fakePage([{ fieldId: 'field-hobby', selector: '#hobby', label: 'What is your hobby?', control: 'textarea', required: false, currentValue: '' }])
    const result = await fillForm(page, [{ fieldId: 'What is your hobby?', value: 'Climbing' }], { allowFieldCompletion: true, allowDocumentUploads: false })
    expect(calls.fill).not.toHaveBeenCalled()
    expect(result.skippedFields[0]).toContain('field not found')
  })

  it('targets one field when multiple controls have the same label', async () => {
    const { page, calls } = fakePage([
      { fieldId: 'field-primary', selector: '#primary', label: 'Email', control: 'input', inputType: 'email', required: true, currentValue: '' },
      { fieldId: 'field-backup', selector: '#backup', label: 'Email', control: 'input', inputType: 'email', required: false, currentValue: '' }
    ])
    const result = await fillForm(page, [{ fieldId: 'field-backup', value: 'backup@example.com' }], { allowFieldCompletion: true, allowDocumentUploads: false })
    expect(calls.fill).toHaveBeenCalledOnce()
    expect(calls.fill).toHaveBeenCalledWith('#backup', 'backup@example.com')
    expect(result.filledFields).toEqual(['Email'])
  })

  it('uses inspected option values for select, radio, and checkbox groups', async () => {
    const { page, calls } = fakePage([
      { fieldId: 'field-country', selector: '#country', label: 'Country', control: 'select', required: true, currentValue: '', options: [{ label: 'Australia', value: 'AU' }] },
      { fieldId: 'field-arrangement', label: 'Work arrangement', control: 'radio', required: true, currentValue: 'remote', options: [{ label: 'Remote', value: 'remote', selector: '#remote' }] },
      { fieldId: 'field-skills', label: 'Skills', control: 'checkbox', required: false, currentValue: [], options: [{ label: 'TypeScript', value: 'ts', selector: '#ts' }, { label: 'Go', value: 'go', selector: '#go' }] }
    ])
    const result = await fillForm(page, [{ fieldId: 'field-country', value: 'AU' }, { fieldId: 'field-arrangement', value: 'remote' }, { fieldId: 'field-skills', value: ['ts'] }], { allowFieldCompletion: true, allowDocumentUploads: false })
    expect(calls.selectOption).toHaveBeenCalledWith('#country', 'AU')
    expect(calls.check).toHaveBeenCalledWith('#remote')
    expect(calls.check).toHaveBeenCalledWith('#ts')
    expect(calls.uncheck).toHaveBeenCalledWith('#go')
    expect(result.filledFields).toHaveLength(3)
  })

  it('never changes a file input during an edit', async () => {
    const { page, calls } = fakePage([{ fieldId: 'field-resume', selector: '#resume', label: 'Upload your résumé', control: 'file', inputType: 'file', required: true, currentValue: '' }])
    const result = await fillForm(page, [{ fieldId: 'field-resume', value: 'resume' }], { allowFieldCompletion: true, allowDocumentUploads: false, updateDocuments: false, resumeFilePath: '/tmp/resume.pdf' })
    expect(calls.setInputFiles).not.toHaveBeenCalled()
    expect(result.skippedFields[0]).toContain('cannot be changed during editing')
    expect(result.requiredPermissions).toEqual([])
  })
})

describe('inspectAnswerRequirements', () => {
  const fields = [
    { fieldId: 'field-contact', label: 'Contact', control: 'input' as const, required: true, currentValue: '' },
    { fieldId: 'field-attachment', label: 'Attachment', control: 'file' as const, required: true, currentValue: '' }
  ]

  it('derives permissions from selected live controls, not label keywords', () => {
    expect(inspectAnswerRequirements(fields, [{ fieldId: 'field-contact', value: 'jane@example.com' }, { fieldId: 'field-attachment', value: 'resume' }])).toEqual(['autoCompleteFields', 'autoUploadDocuments'])
  })

  it('does not request upload permission for editing', () => {
    expect(inspectAnswerRequirements(fields, [{ fieldId: 'field-attachment', value: 'resume' }], false)).toEqual([])
  })
})

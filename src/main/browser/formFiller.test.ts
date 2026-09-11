import { describe, expect, it, vi } from 'vitest'
import type { Page } from 'playwright'
import { JSDOM } from 'jsdom'
import {
  clickApplicationButton,
  fillForm,
  inspectAnswerRequirements,
  inspectApplicationButtons,
  inspectApplicationFields
} from './formFiller'

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
  const visibleRect = {
    x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20,
    toJSON: () => ({})
  } as DOMRect
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => visibleRect
  dom.window.HTMLElement.prototype.getClientRects = () => [visibleRect] as unknown as DOMRectList
  const page = {
    evaluate: vi.fn().mockImplementation(async (callback: (...args: unknown[]) => unknown, arg?: unknown) => {
      const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
      const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
      const previousCss = Object.getOwnPropertyDescriptor(globalThis, 'CSS')
      Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window })
      Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document })
      Object.defineProperty(globalThis, 'CSS', { configurable: true, value: { escape: (value: string) => value } })
      try {
        return callback(arg)
      } finally {
        if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
        else delete (globalThis as { window?: unknown }).window
        if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
        else delete (globalThis as { document?: unknown }).document
        if (previousCss) Object.defineProperty(globalThis, 'CSS', previousCss)
        else delete (globalThis as { CSS?: unknown }).CSS
      }
    }),
    locator: vi.fn().mockImplementation((selector: string) => ({
      fill: async (value: string) => {
        const element = dom.window.document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null
        if (!element) throw new Error(`No element matches ${selector}`)
        element.value = value
      },
      click: async () => {
        const element = dom.window.document.querySelector(selector) as HTMLElement | null
        if (!element) throw new Error(`No element matches ${selector}`)
        element.click()
      }
    }))
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

  it('does not merge same-name choice controls across forms or fieldsets', async () => {
    const { page } = domPage(`
      <form>
        <fieldset><legend>Employment type</legend>
          <label><input type="radio" name="choice" value="full-time">Full time</label>
          <label><input type="radio" name="choice" value="part-time">Part time</label>
        </fieldset>
        <fieldset><legend>Work location</legend>
          <label><input type="radio" name="choice" value="remote">Remote</label>
          <label><input type="radio" name="choice" value="office">Office</label>
        </fieldset>
      </form>
      <form>
        <fieldset><legend>Contact method</legend>
          <label><input type="radio" name="choice" value="email">Email</label>
          <label><input type="radio" name="choice" value="phone">Phone</label>
        </fieldset>
      </form>
    `)

    const fields = await inspectApplicationFields(page)

    expect(fields.map((field) => ({ label: field.label, values: field.options?.map((option) => option.value) }))).toEqual([
      { label: 'Employment type', values: ['full-time', 'part-time'] },
      { label: 'Work location', values: ['remote', 'office'] },
      { label: 'Contact method', values: ['email', 'phone'] }
    ])
  })

  it('omits fields inside a hidden application step', async () => {
    const { page } = domPage(`
      <section><label for="visible">Visible</label><input id="visible"></section>
      <section hidden><label for="hidden">Hidden</label><input id="hidden"></section>
    `)

    const fields = await inspectApplicationFields(page)

    expect(fields.map((field) => field.label)).toEqual(['Visible'])
  })

  it('omits transparent, zero-size, and effectively disabled fields', async () => {
    const { page, document } = domPage(`
      <label for="visible">Visible</label><input id="visible">
      <section style="opacity: 0"><label for="transparent">Transparent</label><input id="transparent"></section>
      <section style="clip-path: inset(50%)"><label for="clipped">Clipped</label><input id="clipped"></section>
      <label for="zero-size">Zero size</label><input id="zero-size">
      <fieldset disabled><label for="disabled">Disabled</label><input id="disabled"></fieldset>
    `)
    document.getElementById('zero-size')!.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
      toJSON: () => ({})
    }) as DOMRect

    const fields = await inspectApplicationFields(page)

    expect(fields.map((field) => field.label)).toEqual(['Visible'])
  })
})

describe('application buttons', () => {
  it('returns visible navigation buttons and omits arbitrary or submit-capable controls', async () => {
    const { page } = domPage(`
      <form>
        <button type="button">Next</button>
        <button type="button">Submit application</button>
        <button type="submit">Submit application</button>
        <button type="reset">Reset</button>
        <input type="button" value="Help">
        <input type="submit" value="Apply now">
        <div role="button" aria-label="More options"></div>
        <section hidden><button type="button">Hidden step action</button></section>
      </form>
      <button>Outside action</button>
      <button type="button" disabled>Disabled action</button>
    `)

    const buttons = await inspectApplicationButtons(page)

    expect(buttons.map((button) => button.label)).toEqual(['Next'])
    expect(buttons.every((button) => button.buttonId.startsWith('applyer-button-'))).toBe(true)
  })

  it('does not expose scripted final actions merely because their native type cannot submit', async () => {
    const { page } = domPage(`
      <button type="button">Finish</button>
      <div role="button">Confirm</div>
      <input type="button" value="Complete">
      <button type="button">Continue</button>
    `)

    expect((await inspectApplicationButtons(page)).map((button) => button.label)).toEqual(['Continue'])
  })

  it('omits transparent, zero-size, and effectively disabled navigation buttons', async () => {
    const { page, document } = domPage(`
      <button type="button">Next</button>
      <section style="opacity: 0"><button type="button">Continue</button></section>
      <section style="clip-path: inset(50%)"><button type="button">Previous</button></section>
      <button id="zero-size" type="button">Proceed</button>
      <fieldset disabled><button type="button">Back</button></fieldset>
    `)
    document.getElementById('zero-size')!.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
      toJSON: () => ({})
    }) as DOMRect

    expect((await inspectApplicationButtons(page)).map((button) => button.label)).toEqual(['Next'])
  })

  it('invalidates a button ID when the control meaning changes', async () => {
    const { page, document } = domPage('<button type="button" id="action">Next</button>')
    const first = (await inspectApplicationButtons(page))[0]!

    document.getElementById('action')!.textContent = 'Back'
    const repurposed = (await inspectApplicationButtons(page))[0]!

    expect(repurposed.buttonId).not.toBe(first.buttonId)
  })

  it('blocks scripted form submission while clicking an allowed button', async () => {
    const { page, document } = domPage(`
      <form id="application"><button type="button" id="next">Next</button></form>
    `)
    const form = document.getElementById('application') as HTMLFormElement
    const originalRequestSubmit = form.ownerDocument.defaultView!.HTMLFormElement.prototype.requestSubmit
    const submitted = vi.fn((event: Event) => event.preventDefault())
    form.addEventListener('submit', submitted)
    document.getElementById('next')!.addEventListener('click', () => form.requestSubmit())
    const button = (await inspectApplicationButtons(page))[0]!

    await clickApplicationButton(page, button.buttonId, async () => true)

    expect(submitted).not.toHaveBeenCalled()
    expect(form.ownerDocument.defaultView!.HTMLFormElement.prototype.requestSubmit).toBe(originalRequestSubmit)
  })

  it('refuses a stale ID after an allowed button becomes a submit button', async () => {
    const { page, document } = domPage(`
      <form><button type="button" id="action">Next</button></form>
    `)
    const button = (await inspectApplicationButtons(page))[0]!
    ;(document.getElementById('action') as HTMLButtonElement).type = 'submit'

    await expect(clickApplicationButton(page, button.buttonId, async () => true)).rejects.toThrow('no longer safe')
  })

  it('revalidates the button after permission is granted', async () => {
    const { page, document } = domPage('<button type="button" id="action">Next</button>')
    const button = (await inspectApplicationButtons(page))[0]!

    await expect(clickApplicationButton(page, button.buttonId, async () => {
      document.getElementById('action')!.textContent = 'Back'
      return true
    })).rejects.toThrow('button changed while permission was pending')
  })

  it('consumes every button ID from an inspection after one click', async () => {
    const { page } = domPage(`
      <button type="button">Back</button>
      <button type="button">Next</button>
    `)
    const buttons = await inspectApplicationButtons(page)

    await clickApplicationButton(page, buttons[1]!.buttonId, async () => true)

    await expect(clickApplicationButton(page, buttons[0]!.buttonId, async () => true)).rejects.toThrow('inspect the form again')
    const fresh = await inspectApplicationButtons(page)
    expect(fresh.map((button) => button.buttonId)).not.toEqual(buttons.map((button) => button.buttonId))
  })

  it('serializes concurrent clicks so only one capability can be consumed', async () => {
    const { page } = domPage('<button type="button">Next</button>')
    const button = (await inspectApplicationButtons(page))[0]!

    const outcomes = await Promise.allSettled([
      clickApplicationButton(page, button.buttonId, async () => true),
      clickApplicationButton(page, button.buttonId, async () => true)
    ])

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
  })

  it('consumes the capability without clicking when authorization is denied', async () => {
    const { page, document } = domPage('<button id="next" type="button">Next</button>')
    const clicked = vi.fn()
    document.getElementById('next')!.addEventListener('click', clicked)
    const button = (await inspectApplicationButtons(page))[0]!

    await expect(clickApplicationButton(page, button.buttonId, async () => false)).rejects.toThrow('permission denied')

    expect(clicked).not.toHaveBeenCalled()
    await expect(clickApplicationButton(page, button.buttonId, async () => true)).rejects.toThrow('inspect the form again')
  })

  it('navigates back, re-inspects, and edits a field from an earlier step', async () => {
    const { page, document } = domPage(`
      <form>
        <fieldset id="step-one" hidden>
          <label for="email">Email</label>
          <input id="email" name="email" type="email" value="old@example.com">
        </fieldset>
        <fieldset id="step-two">
          <label for="portfolio">Portfolio</label>
          <input id="portfolio" name="portfolio" type="url">
          <button id="back" type="button">Back</button>
          <button type="submit">Submit application</button>
        </fieldset>
      </form>
    `)
    document.getElementById('back')!.addEventListener('click', () => {
      ;(document.getElementById('step-one') as HTMLElement).hidden = false
      ;(document.getElementById('step-two') as HTMLElement).hidden = true
    })

    expect((await inspectApplicationFields(page)).map((field) => field.label)).toEqual(['Portfolio'])
    const buttons = await inspectApplicationButtons(page)
    expect(buttons.map((button) => button.label)).toEqual(['Back'])

    await clickApplicationButton(page, buttons[0]!.buttonId, async () => true)
    const email = (await inspectApplicationFields(page)).find((field) => field.label === 'Email')!
    const result = await fillForm(page, [{ fieldId: email.fieldId, value: 'new@example.com' }], {
      allowFieldCompletion: true,
      allowDocumentUploads: false
    })

    expect(result.filledFields).toEqual(['Email'])
    expect((document.getElementById('email') as HTMLInputElement).value).toBe('new@example.com')
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

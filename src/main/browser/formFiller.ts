import type { Page } from 'playwright'
import type { AgentPermission } from '@shared/types/agentPermissions'

export type ApplicationFieldValue = string | boolean | string[]

export interface ApplicationFieldAnswer {
  /** Must be copied from the latest inspect_application result. */
  fieldId: string
  value: ApplicationFieldValue
}

export interface ApplicationFieldOption {
  label: string
  value: string
}

export interface ApplicationField {
  /** Opaque identity tied to this control in the retained live DOM. */
  fieldId: string
  label: string
  name?: string
  placeholder?: string
  autocomplete?: string
  control: 'input' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'file'
  inputType?: string
  required: boolean
  currentValue: ApplicationFieldValue
  options?: ApplicationFieldOption[]
}

export interface ApplicationButton {
  /** Must be copied from the latest inspect_application result. */
  buttonId: string
  label: string
}

interface FieldDescriptor extends ApplicationField {
  selector?: string
  options?: Array<ApplicationFieldOption & { fieldId?: string; selector?: string; checked?: boolean }>
}

interface ButtonDescriptor extends ApplicationButton {
  selector: string
}

/**
 * Reads native form controls without interpreting what any question means.
 * The returned opaque field IDs are the only identifiers accepted later.
 */
async function collectFields(page: Page): Promise<FieldDescriptor[]> {
  return page.evaluate((): FieldDescriptor[] => {
    const claimedFieldIds = new Set<string>()

    function visible(el: Element): boolean {
      for (let current: Element | null = el; current; current = current.parentElement) {
        const style = window.getComputedStyle(current)
        const normalizedClip = style.clip.replace(/\s+/g, '')
        const normalizedClipPath = style.clipPath.replace(/\s+/g, '')
        if (current.hasAttribute('hidden') || current.getAttribute('aria-hidden') === 'true' ||
          style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' ||
          style.contentVisibility === 'hidden' || Number.parseFloat(style.opacity) === 0 ||
          /^rect\(0(?:px)?,0(?:px)?,0(?:px)?,0(?:px)?\)$/.test(normalizedClip) ||
          /^(?:inset\(50%(?:50%){0,3}\)|circle\(0(?:px|%)?\))$/.test(normalizedClipPath)) return false
      }
      const rect = el.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0 || el.getClientRects().length === 0) return false
      for (let current = el.parentElement; current; current = current.parentElement) {
        const style = window.getComputedStyle(current)
        const clipsX = style.overflowX === 'hidden' || style.overflowX === 'clip'
        const clipsY = style.overflowY === 'hidden' || style.overflowY === 'clip'
        if (!clipsX && !clipsY) continue
        const ancestorRect = current.getBoundingClientRect()
        if ((clipsX && (rect.right <= ancestorRect.left || rect.left >= ancestorRect.right)) ||
          (clipsY && (rect.bottom <= ancestorRect.top || rect.top >= ancestorRect.bottom))) return false
      }
      return true
    }

    function labelledBy(el: Element): string {
      const ids = el.getAttribute('aria-labelledby')?.trim().split(/\s+/) ?? []
      return ids
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
        .filter(Boolean)
        .join(' ')
    }

    function directLabel(el: Element): string {
      const id = el.getAttribute('id')
      if (id) {
        const label = document.querySelector(`label[for="${CSS.escape(id)}"]`)
        if (label?.textContent?.trim()) return label.textContent.trim()
      }
      const ariaLabel = el.getAttribute('aria-label')?.trim()
      if (ariaLabel) return ariaLabel
      const ariaLabelledBy = labelledBy(el)
      if (ariaLabelledBy) return ariaLabelledBy
      const closestLabel = el.closest('label')
      if (closestLabel?.textContent?.trim()) return closestLabel.textContent.trim()
      const placeholder = el.getAttribute('placeholder')?.trim()
      if (placeholder) return placeholder
      return el.getAttribute('name')?.trim() || id?.trim() || ''
    }

    function groupLabel(el: Element): string {
      const fieldset = el.closest('fieldset')
      const legend = fieldset?.querySelector(':scope > legend')?.textContent?.trim()
      return legend || labelledBy(el) || el.getAttribute('name')?.trim() || directLabel(el)
    }

    function fieldIdFor(el: Element, signature: string): string {
      let tagged = el.getAttribute('data-applyer-field')
      const previousSignature = el.getAttribute('data-applyer-field-signature')
      if (!tagged?.startsWith('applyer-field-') || claimedFieldIds.has(tagged) || previousSignature !== signature) {
        do tagged = `applyer-field-${Math.random().toString(36).slice(2)}`
        while (claimedFieldIds.has(tagged))
      }
      el.setAttribute('data-applyer-field', tagged)
      el.setAttribute('data-applyer-field-signature', signature)
      claimedFieldIds.add(tagged)
      return tagged
    }

    function selectorFor(fieldId: string): string {
      return `[data-applyer-field="${CSS.escape(fieldId)}"]`
    }

    const controls = Array.from(document.querySelectorAll('input, textarea, select'))
      .filter((control) => visible(control) && !control.matches(':disabled'))
    const results: FieldDescriptor[] = []
    const grouped = new Set<Element>()

    for (const el of controls) {
      if (grouped.has(el)) continue
      const tag = el.tagName.toLowerCase()
      const inputType = tag === 'input' ? (el.getAttribute('type') ?? 'text').toLowerCase() : undefined
      if (inputType && ['hidden', 'password', 'submit', 'button', 'image', 'reset'].includes(inputType)) continue

      if (inputType === 'radio' || inputType === 'checkbox') {
        const name = el.getAttribute('name')
        const formOwner = (el as HTMLInputElement).form
        const semanticGroup = el.closest('fieldset')
        const peers = name
          ? controls.filter(
              (candidate) =>
                candidate.tagName.toLowerCase() === 'input' &&
                (candidate.getAttribute('type') ?? 'text').toLowerCase() === inputType &&
                candidate.getAttribute('name') === name &&
                (candidate as HTMLInputElement).form === formOwner &&
                candidate.closest('fieldset') === semanticGroup
            )
          : [el]
        peers.forEach((peer) => grouped.add(peer))

        const isSingleCheckbox = inputType === 'checkbox' && peers.length === 1
        const label = isSingleCheckbox ? directLabel(el) : groupLabel(el)
        const optionDetails = peers.map((peer) => {
          const input = peer as HTMLInputElement
          return {
            label: directLabel(peer),
            value: input.value,
            checked: input.checked
          }
        })
        const signature = JSON.stringify({
          label,
          name,
          inputType,
          required: peers.some((peer) => (peer as HTMLInputElement).required),
          options: optionDetails.map(({ label: optionLabel, value }) => ({ label: optionLabel, value }))
        })
        const fieldId = fieldIdFor(peers[0]!, signature)
        const options = optionDetails.map((option, index) => {
          const optionFieldId = index === 0
            ? fieldId
            : fieldIdFor(peers[index]!, JSON.stringify({ group: signature, index, label: option.label, value: option.value }))
          return { ...option, fieldId: optionFieldId, selector: selectorFor(optionFieldId) }
        })
        results.push({
          fieldId,
          selector: isSingleCheckbox ? options[0]?.selector : undefined,
          label,
          name: el.getAttribute('name')?.trim() || undefined,
          control: inputType,
          required: peers.some((peer) => (peer as HTMLInputElement).required),
          currentValue: inputType === 'radio'
            ? options.find((option) => option.checked)?.value ?? ''
            : isSingleCheckbox
              ? (peers[0] as HTMLInputElement).checked
              : options.filter((option) => option.checked).map((option) => option.value),
          options: isSingleCheckbox ? undefined : options
        })
        continue
      }

      if (tag === 'select') {
        const select = el as HTMLSelectElement
        const label = directLabel(el)
        const selectOptions = Array.from(select.options).map((option) => ({ label: option.text.trim(), value: option.value }))
        const fieldId = fieldIdFor(el, JSON.stringify({
          label,
          name: el.getAttribute('name'),
          autocomplete: el.getAttribute('autocomplete'),
          multiple: select.multiple,
          required: select.required,
          options: selectOptions
        }))
        results.push({
          fieldId,
          selector: selectorFor(fieldId),
          label,
          name: el.getAttribute('name')?.trim() || undefined,
          autocomplete: el.getAttribute('autocomplete')?.trim() || undefined,
          control: 'select',
          required: select.required,
          currentValue: select.multiple
            ? Array.from(select.selectedOptions).map((option) => option.value)
            : select.value,
          options: selectOptions
        })
        continue
      }

      const input = el as HTMLInputElement | HTMLTextAreaElement
      const label = directLabel(el)
      const fieldId = fieldIdFor(el, JSON.stringify({
        label,
        name: el.getAttribute('name'),
        tag,
        inputType,
        placeholder: el.getAttribute('placeholder'),
        autocomplete: el.getAttribute('autocomplete'),
        required: input.required
      }))
      results.push({
        fieldId,
        selector: selectorFor(fieldId),
        label,
        name: el.getAttribute('name')?.trim() || undefined,
        placeholder: el.getAttribute('placeholder')?.trim() || undefined,
        autocomplete: el.getAttribute('autocomplete')?.trim() || undefined,
        control: inputType === 'file' ? 'file' : tag === 'textarea' ? 'textarea' : 'input',
        inputType,
        required: input.required,
        currentValue: inputType === 'file' ? '' : input.value
      })
    }

    return results.filter((field) => field.label.trim().length > 0)
  })
}

export async function inspectApplicationFields(page: Page): Promise<ApplicationField[]> {
  const fields = await collectFields(page)
  return fields.map((field) => {
    const inspected: ApplicationField = {
      fieldId: field.fieldId,
      label: field.label,
      control: field.control,
      required: field.required,
      currentValue: field.currentValue
    }
    if (field.inputType !== undefined) inspected.inputType = field.inputType
    if (field.name !== undefined) inspected.name = field.name
    if (field.placeholder !== undefined) inspected.placeholder = field.placeholder
    if (field.autocomplete !== undefined) inspected.autocomplete = field.autocomplete
    if (field.options !== undefined) {
      inspected.options = field.options.map((option) => ({ label: option.label, value: option.value }))
    }
    return inspected
  })
}

/**
 * Returns only controls with a navigation-like label. A label cannot prove
 * what an arbitrary site handler will do, so the caller must obtain explicit
 * button-press permission before using any returned capability.
 */
async function collectButtons(page: Page, newInspection: boolean): Promise<ButtonDescriptor[]> {
  return page.evaluate(({ newInspection }): ButtonDescriptor[] => {
    const claimedButtonIds = new Set<string>()
    const buttonAttribute = 'data-applyer-button'
    const signatureAttribute = 'data-applyer-button-signature'
    const generationAttribute = 'data-applyer-button-generation'

    let generation: string | null
    if (newInspection) {
      for (const tagged of Array.from(document.querySelectorAll(`[${buttonAttribute}]`))) {
        tagged.removeAttribute(buttonAttribute)
        tagged.removeAttribute(signatureAttribute)
        tagged.removeAttribute(generationAttribute)
      }
      generation = Math.random().toString(36).slice(2)
      document.documentElement.setAttribute(generationAttribute, generation)
    } else {
      generation = document.documentElement.getAttribute(generationAttribute)
    }
    if (!generation) return []
    const activeGeneration = generation

    function visible(el: Element): boolean {
      for (let current: Element | null = el; current; current = current.parentElement) {
        const style = window.getComputedStyle(current)
        const normalizedClip = style.clip.replace(/\s+/g, '')
        const normalizedClipPath = style.clipPath.replace(/\s+/g, '')
        if (current.hasAttribute('hidden') || current.getAttribute('aria-hidden') === 'true' ||
          style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' ||
          style.contentVisibility === 'hidden' || Number.parseFloat(style.opacity) === 0 ||
          /^rect\(0(?:px)?,0(?:px)?,0(?:px)?,0(?:px)?\)$/.test(normalizedClip) ||
          /^(?:inset\(50%(?:50%){0,3}\)|circle\(0(?:px|%)?\))$/.test(normalizedClipPath)) return false
      }
      const rect = el.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0 || el.getClientRects().length === 0) return false
      for (let current = el.parentElement; current; current = current.parentElement) {
        const style = window.getComputedStyle(current)
        const clipsX = style.overflowX === 'hidden' || style.overflowX === 'clip'
        const clipsY = style.overflowY === 'hidden' || style.overflowY === 'clip'
        if (!clipsX && !clipsY) continue
        const ancestorRect = current.getBoundingClientRect()
        if ((clipsX && (rect.right <= ancestorRect.left || rect.left >= ancestorRect.right)) ||
          (clipsY && (rect.bottom <= ancestorRect.top || rect.top >= ancestorRect.bottom))) return false
      }
      return true
    }

    function labelledBy(el: Element): string {
      const ids = el.getAttribute('aria-labelledby')?.trim().split(/\s+/) ?? []
      return ids
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
        .filter(Boolean)
        .join(' ')
    }

    function buttonLabel(el: Element): string {
      const ariaLabel = el.getAttribute('aria-label')?.trim()
      if (ariaLabel) return ariaLabel
      const ariaLabelledBy = labelledBy(el)
      if (ariaLabelledBy) return ariaLabelledBy
      if (el.tagName.toLowerCase() === 'input' && (el as HTMLInputElement).value.trim()) {
        return (el as HTMLInputElement).value.trim()
      }
      const text = el.textContent?.trim()
      if (text) return text
      return el.getAttribute('title')?.trim() || el.getAttribute('name')?.trim() || el.id.trim()
    }

    function isSafeButton(el: Element): boolean {
      if (!visible(el)) return false
      if (el.matches(':disabled')) return false
      const tag = el.tagName.toLowerCase()
      if (tag === 'button') {
        const button = el as HTMLButtonElement
        if (button.disabled || button.type === 'reset') return false
        // A missing type defaults to submit only when the button owns a form.
        return button.type !== 'submit' || button.form === null
      }
      if (tag === 'input') {
        const input = el as HTMLInputElement
        return !input.disabled && input.type === 'button'
      }
      return el.getAttribute('role') === 'button' && el.getAttribute('aria-disabled') !== 'true'
    }

    function looksLikeFinalSubmission(el: Element, label: string): boolean {
      const semanticText = [
        label,
        el.id,
        el.getAttribute('name'),
        el.getAttribute('value'),
        el.getAttribute('title'),
        el.getAttribute('data-testid')
      ].filter(Boolean).join(' ')
      return /\b(submit|apply\s*(?:now)?|send\s+(?:my\s+)?application|complete\s+application|finish\s+application|finali[sz]e\s+application)\b/i.test(semanticText)
    }

    function isNavigationLabel(label: string): boolean {
      const normalized = label.toLowerCase().replace(/\s+/g, ' ').trim()
      return /^(?:(?:←|‹|«)\s*)?(?:back|go back|previous)(?:\s+(?:step|page))?$/.test(normalized) ||
        /^(?:next|continue|proceed)(?:\s+(?:to\s+)?(?:the\s+)?(?:next\s+)?(?:step|page))?(?:\s*(?:→|›|»))?$/.test(normalized)
    }

    function buttonIdFor(el: Element, signature: string): string {
      let tagged = el.getAttribute(buttonAttribute)
      const previousSignature = el.getAttribute(signatureAttribute)
      const previousGeneration = el.getAttribute(generationAttribute)
      if (!newInspection) {
        if (!tagged?.startsWith('applyer-button-') || claimedButtonIds.has(tagged) ||
          previousSignature !== signature || previousGeneration !== activeGeneration) return ''
        claimedButtonIds.add(tagged)
        return tagged
      }
      if (!tagged?.startsWith('applyer-button-') || claimedButtonIds.has(tagged)) {
        do tagged = `applyer-button-${Math.random().toString(36).slice(2)}`
        while (claimedButtonIds.has(tagged))
      }
      el.setAttribute(buttonAttribute, tagged)
      el.setAttribute(signatureAttribute, signature)
      el.setAttribute(generationAttribute, activeGeneration)
      claimedButtonIds.add(tagged)
      return tagged
    }

    const results: ButtonDescriptor[] = []
    for (const el of Array.from(document.querySelectorAll('button, input[type="button"], [role="button"]'))) {
      if (!isSafeButton(el)) continue
      const label = buttonLabel(el)
      if (!label || !isNavigationLabel(label) || looksLikeFinalSubmission(el, label)) continue
      const signature = JSON.stringify({
        label,
        tag: el.tagName.toLowerCase(),
        type: el.tagName.toLowerCase() === 'button' || el.tagName.toLowerCase() === 'input'
          ? (el as HTMLButtonElement | HTMLInputElement).type
          : undefined,
        role: el.getAttribute('role'),
        name: el.getAttribute('name')
      })
      const buttonId = buttonIdFor(el, signature)
      if (!buttonId) continue
      results.push({
        buttonId,
        label,
        selector: `[data-applyer-button="${CSS.escape(buttonId)}"]`
      })
    }
    return results
  }, { newInspection })
}

export async function inspectApplicationButtons(page: Page): Promise<ApplicationButton[]> {
  const buttons = await collectButtons(page, true)
  return buttons.map(({ buttonId, label }) => ({ buttonId, label }))
}

const buttonClickQueues = new WeakMap<Page, Promise<unknown>>()

function serializeButtonClick<T>(page: Page, click: () => Promise<T>): Promise<T> {
  const previous = buttonClickQueues.get(page) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(click)
  buttonClickQueues.set(page, current)
  return current.finally(() => {
    if (buttonClickQueues.get(page) === current) buttonClickQueues.delete(page)
  })
}

/**
 * Clicks one inspected navigation button after caller-provided authorization,
 * while suppressing native form submission APIs. Arbitrary site handlers are
 * why authorization is mandatory. The descriptor is checked again so a
 * repurposed DOM node cannot be clicked under a stale ID.
 */
export async function clickApplicationButton(
  page: Page,
  buttonId: string,
  authorize: (button: ApplicationButton) => Promise<boolean>,
  beforeClick?: () => Promise<void>
): Promise<ApplicationButton> {
  return serializeButtonClick(page, async () => {
    const button = (await collectButtons(page, false)).find((candidate) => candidate.buttonId === buttonId)
    if (!button) throw new Error('button not found or is no longer safe; inspect the form again')

    try {
      if (!(await authorize({ buttonId: button.buttonId, label: button.label }))) {
        throw new Error('button press permission denied; inspect the form again')
      }
      const currentButton = (await collectButtons(page, false)).find((candidate) => candidate.buttonId === buttonId)
      if (!currentButton || currentButton.label !== button.label || currentButton.selector !== button.selector) {
        throw new Error('button changed while permission was pending; inspect the form again')
      }
      await beforeClick?.()
      const dispatchButton = (await collectButtons(page, false)).find((candidate) => candidate.buttonId === buttonId)
      if (!dispatchButton || dispatchButton.label !== button.label || dispatchButton.selector !== button.selector) {
        throw new Error('button changed before it could be clicked; inspect the form again')
      }
      // Consume the whole inspection generation immediately before dispatch,
      // so queued calls cannot reuse this button or one of its siblings.
      await page.evaluate(() => {
        document.documentElement.removeAttribute('data-applyer-button-generation')
      })
      await page.evaluate(() => {
        const guardedWindow = window as typeof window & { __applyerRestoreSubmissionGuard?: () => void }
        guardedWindow.__applyerRestoreSubmissionGuard?.()

        const formPrototype = window.HTMLFormElement.prototype
        const originalSubmit = formPrototype.submit
        const originalRequestSubmit = formPrototype.requestSubmit
        const preventSubmit = (event: Event): void => {
          event.preventDefault()
          event.stopImmediatePropagation()
        }
        document.addEventListener('submit', preventSubmit, true)
        formPrototype.submit = function blockedSubmit(): void {
          // Deliberately suppress scripted submission during an approved agent click.
        }
        formPrototype.requestSubmit = function blockedRequestSubmit(): void {
          // Deliberately suppress scripted submission during an approved agent click.
        }
        guardedWindow.__applyerRestoreSubmissionGuard = (): void => {
          document.removeEventListener('submit', preventSubmit, true)
          formPrototype.submit = originalSubmit
          formPrototype.requestSubmit = originalRequestSubmit
          delete guardedWindow.__applyerRestoreSubmissionGuard
        }
      })
      await page.locator(dispatchButton.selector).click()
    } finally {
      await page.evaluate(() => {
        const guardedWindow = window as typeof window & { __applyerRestoreSubmissionGuard?: () => void }
        guardedWindow.__applyerRestoreSubmissionGuard?.()
        for (const tagged of Array.from(document.querySelectorAll('[data-applyer-button]'))) {
          tagged.removeAttribute('data-applyer-button')
          tagged.removeAttribute('data-applyer-button-signature')
          tagged.removeAttribute('data-applyer-button-generation')
        }
      }).catch(() => {})
    }

    return { buttonId: button.buttonId, label: button.label }
  })
}

export interface FillFormOptions {
  allowFieldCompletion: boolean
  allowDocumentUploads: boolean
  /** File controls are immutable during edit_application. */
  updateDocuments?: boolean
  resumeFilePath?: string
  coverLetterFilePath?: string
}

export interface FillFormResult {
  filledFields: string[]
  skippedFields: string[]
  requiredPermissions: AgentPermission[]
}

export function inspectAnswerRequirements(
  fields: ApplicationField[],
  answers: ApplicationFieldAnswer[],
  includeDocumentUploads = true
): AgentPermission[] {
  const byFieldId = new Map(fields.map((field) => [field.fieldId, field]))

  const required = new Set<AgentPermission>()
  for (const answer of answers) {
    const field = byFieldId.get(answer.fieldId)
    if (!field) continue
    if (field.control === 'file') {
      if (includeDocumentUploads) required.add('autoUploadDocuments')
    } else {
      required.add('autoCompleteFields')
    }
  }
  return [...required]
}

function scalarValue(value: ApplicationFieldValue): string | null {
  return typeof value === 'string' ? value : null
}

/** Fills only opaque field IDs explicitly supplied by the MCP agent. */
export async function fillForm(
  page: Page,
  answers: ApplicationFieldAnswer[],
  options: FillFormOptions
): Promise<FillFormResult> {
  const fields = await collectFields(page)
  const byFieldId = new Map(fields.map((field) => [field.fieldId, field]))

  const filledFields: string[] = []
  const skippedFields: string[] = []
  const requiredPermissions = new Set<AgentPermission>()
  const usedFieldIds = new Set<string>()

  for (const answer of answers) {
    if (usedFieldIds.has(answer.fieldId)) {
      skippedFields.push(`${answer.fieldId} (duplicate answer)`)
      continue
    }
    usedFieldIds.add(answer.fieldId)
    const field = byFieldId.get(answer.fieldId)
    if (!field) {
      skippedFields.push(`${answer.fieldId} (field not found; inspect the form again)`)
      continue
    }
    try {
      if (field.control === 'file') {
        if (options.updateDocuments === false) {
          skippedFields.push(`${field.label} (attachments cannot be changed during editing)`)
          continue
        }
        if (!options.allowDocumentUploads) {
          requiredPermissions.add('autoUploadDocuments')
          skippedFields.push(`${field.label} (automatic document uploads are not allowed)`)
          continue
        }
        const documentKind = scalarValue(answer.value)
        const path = documentKind === 'resume' ? options.resumeFilePath : documentKind === 'cover_letter' ? options.coverLetterFilePath : undefined
        if (!path) {
          skippedFields.push(`${field.label} (value must name an available stored document: resume or cover_letter)`)
          continue
        }
        await page.locator(field.selector!).setInputFiles(path)
        filledFields.push(field.label)
        continue
      }

      if (!options.allowFieldCompletion) {
        requiredPermissions.add('autoCompleteFields')
        skippedFields.push(`${field.label} (automatic field completion is not allowed)`)
        continue
      }

      if (field.control === 'input' || field.control === 'textarea') {
        const value = scalarValue(answer.value)
        if (value === null) throw new Error('expected a string value')
        await page.locator(field.selector!).fill(value)
      } else if (field.control === 'select') {
        if (typeof answer.value !== 'string' && !Array.isArray(answer.value)) throw new Error('expected an option value')
        await page.locator(field.selector!).selectOption(answer.value)
      } else if (field.control === 'radio') {
        const value = scalarValue(answer.value)
        const option = value === null ? undefined : field.options?.find((candidate) => candidate.value === value)
        if (!option?.selector) throw new Error('value is not one of the inspected options')
        await page.locator(option.selector).check()
      } else if (field.control === 'checkbox') {
        if (field.options) {
          if (!Array.isArray(answer.value)) throw new Error('expected an array of option values')
          const requested = new Set(answer.value)
          const known = new Set(field.options.map((option) => option.value))
          if ([...requested].some((value) => !known.has(value))) throw new Error('value is not one of the inspected options')
          for (const option of field.options) {
            const locator = page.locator(option.selector!)
            if (requested.has(option.value)) await locator.check()
            else await locator.uncheck()
          }
        } else {
          if (typeof answer.value !== 'boolean') throw new Error('expected a boolean value')
          const locator = page.locator(field.selector!)
          if (answer.value) await locator.check()
          else await locator.uncheck()
        }
      }
      filledFields.push(field.label)
    } catch (error) {
      skippedFields.push(`${field.label} (failed: ${String(error)})`)
    }
  }

  return { filledFields, skippedFields, requiredPermissions: [...requiredPermissions] }
}

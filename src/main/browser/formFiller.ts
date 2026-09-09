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

interface FieldDescriptor extends ApplicationField {
  selector?: string
  options?: Array<ApplicationFieldOption & { fieldId?: string; selector?: string; checked?: boolean }>
}

/**
 * Reads native form controls without interpreting what any question means.
 * The returned opaque field IDs are the only identifiers accepted later.
 */
async function collectFields(page: Page): Promise<FieldDescriptor[]> {
  return page.evaluate((): FieldDescriptor[] => {
    const claimedFieldIds = new Set<string>()

    function visible(el: Element): boolean {
      const style = window.getComputedStyle(el)
      return style.display !== 'none' && style.visibility !== 'hidden'
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

    const controls = Array.from(document.querySelectorAll('input, textarea, select')).filter(visible)
    const results: FieldDescriptor[] = []
    const grouped = new Set<Element>()

    for (const el of controls) {
      if (grouped.has(el)) continue
      const tag = el.tagName.toLowerCase()
      const inputType = tag === 'input' ? (el.getAttribute('type') ?? 'text').toLowerCase() : undefined
      if (inputType && ['hidden', 'password', 'submit', 'button', 'image', 'reset'].includes(inputType)) continue

      if (inputType === 'radio' || inputType === 'checkbox') {
        const name = el.getAttribute('name')
        const peers = name
          ? controls.filter(
              (candidate) =>
                candidate.tagName.toLowerCase() === 'input' &&
                (candidate.getAttribute('type') ?? 'text').toLowerCase() === inputType &&
                candidate.getAttribute('name') === name
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

import type { Page } from 'playwright'
import type { ProfileFields } from '@shared/types/profile'
import type { AgentPermission } from '@shared/types/agentPermissions'

type FieldCategory =
  | 'fullName'
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'phone'
  | 'location'
  | 'linkedin'
  | 'github'
  | 'portfolio'
  | 'resume'
  | 'coverLetter'

interface FieldDescriptor {
  selector: string
  tag: 'input' | 'textarea'
  type: string
  label: string
}

/**
 * Ordered so more specific patterns (first/last name) are checked before the
 * generic "name" pattern they'd otherwise also match.
 */
const CATEGORY_PATTERNS: [FieldCategory, RegExp][] = [
  ['firstName', /first\s*name/i],
  ['lastName', /last\s*name/i],
  ['fullName', /full\s*name|legal\s*name|your\s*name|^name$/i],
  ['email', /e-?mail/i],
  ['phone', /phone|mobile|telephone/i],
  ['linkedin', /linked\s*in/i],
  ['github', /git\s*hub/i],
  ['portfolio', /portfolio|personal\s*(site|website)|^website$/i],
  ['location', /location|city|current\s*(location|city)|where.*(live|based)/i],
  ['resume', /r[ée]sum[ée]|\bcv\b/i],
  ['coverLetter', /cover\s*letter/i]
]

function matchCategory(label: string): FieldCategory | null {
  const normalized = label.trim()
  if (!normalized) return null
  for (const [category, pattern] of CATEGORY_PATTERNS) {
    if (pattern.test(normalized)) return category
  }
  return null
}

/** Collects a serializable description of every fillable field on the page — resolution happens in-page since it needs live DOM/label associations. */
async function collectFields(page: Page): Promise<FieldDescriptor[]> {
  return page.evaluate((): FieldDescriptor[] => {
    function resolveLabel(el: Element): string {
      const id = el.getAttribute('id')
      if (id) {
        const forLabel = document.querySelector(`label[for="${CSS.escape(id)}"]`)
        if (forLabel?.textContent?.trim()) return forLabel.textContent.trim()
      }
      const ariaLabel = el.getAttribute('aria-label')
      if (ariaLabel?.trim()) return ariaLabel.trim()
      const ariaLabelledBy = el.getAttribute('aria-labelledby')
      if (ariaLabelledBy) {
        const labelled = document.getElementById(ariaLabelledBy)
        if (labelled?.textContent?.trim()) return labelled.textContent.trim()
      }
      const closestLabel = el.closest('label')
      if (closestLabel?.textContent?.trim()) return closestLabel.textContent.trim()
      const placeholder = el.getAttribute('placeholder')
      if (placeholder?.trim()) return placeholder.trim()
      return el.getAttribute('name') ?? id ?? ''
    }

    function cssSelectorFor(el: Element): string {
      const id = el.getAttribute('id')
      if (id) return `#${CSS.escape(id)}`
      const name = el.getAttribute('name')
      if (name) return `[name="${CSS.escape(name)}"]`
      // Last resort: a data attribute we tag onto the element ourselves.
      const tagged = `applyer-field-${Math.random().toString(36).slice(2)}`
      el.setAttribute('data-applyer-field', tagged)
      return `[data-applyer-field="${tagged}"]`
    }

    const results: FieldDescriptor[] = []
    document.querySelectorAll('input, textarea').forEach((el) => {
      const type = (el.getAttribute('type') ?? 'text').toLowerCase()
      if (['hidden', 'checkbox', 'radio', 'submit', 'button'].includes(type)) return
      const style = window.getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') return

      results.push({
        selector: cssSelectorFor(el),
        tag: el.tagName.toLowerCase() as 'input' | 'textarea',
        type,
        label: resolveLabel(el)
      })
    })
    return results
  })
}

function valueForCategory(category: FieldCategory, profile: ProfileFields): string | null {
  switch (category) {
    case 'fullName':
      return profile.fullName || null
    case 'firstName':
      return profile.fullName.split(/\s+/)[0] || null
    case 'lastName': {
      const parts = profile.fullName.split(/\s+/)
      return parts.length > 1 ? parts.slice(1).join(' ') : null
    }
    case 'email':
      return profile.email || null
    case 'phone':
      return profile.phone || null
    case 'location':
      return profile.location || null
    case 'linkedin':
      return profile.linkedinUrl || null
    case 'github':
      return profile.githubUrl || null
    case 'portfolio':
      return profile.portfolioUrl || null
    case 'resume':
    case 'coverLetter':
      return null // handled separately as file uploads
  }
}

const QUESTION_NOISE_WORDS = new Set([
  'a', 'an', 'are', 'do', 'does', 'how', 'i', 'is', 'of', 'please', 'the', 'to', 'what', 'when', 'where', 'why', 'you', 'your'
])

function questionTokens(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .replace(/what['’]s/g, 'what is')
    .normalize('NFKD')
    .match(/[\p{L}\p{N}]+/gu)?.filter((word) => !QUESTION_NOISE_WORDS.has(word)) ?? []
}

/**
 * Labels vary a little between ATSs (for example, "What is your hobby?" and
 * "Hobby *"). Match a saved answer when its meaningful words are the same,
 * while keeping this deterministic and confined to answers the user stored.
 */
function matchesQuestion(label: string, question: string): boolean {
  const labelTokens = questionTokens(label)
  const savedTokens = questionTokens(question)
  if (labelTokens.length === 0 || savedTokens.length === 0) return false
  if (labelTokens.join(' ') === savedTokens.join(' ')) return true
  return labelTokens.length === 1 && savedTokens.length === 1 && labelTokens[0] === savedTokens[0]
}

function additionalAnswerFor(label: string, profile: ProfileFields): string | null {
  const match = profile.additionalInformation.find((item) => matchesQuestion(label, item.question))
  return match?.answer.trim() || null
}

function supportsAdditionalAnswer(field: FieldDescriptor): boolean {
  return field.tag === 'textarea' || (field.tag === 'input' && ['text', 'search'].includes(field.type))
}

export interface FillFormOptions {
  allowFieldCompletion: boolean
  allowDocumentUploads: boolean
  resumeFilePath?: string
  coverLetterFilePath?: string
}

export interface FillFormResult {
  filledFields: string[]
  skippedFields: string[]
  requiredPermissions: AgentPermission[]
}

export interface AvailableFillDocuments {
  resume: boolean
  coverLetter: boolean
}

/**
 * Inspects the live form without entering any data. Only capabilities that
 * would perform a real action are returned: an empty profile field or a file
 * input with no matching stored document does not produce a needless prompt.
 */
export async function inspectFillRequirements(
  page: Page,
  profile: ProfileFields,
  documents: AvailableFillDocuments
): Promise<AgentPermission[]> {
  const fields = await collectFields(page)
  const required = new Set<AgentPermission>()

  for (const field of fields) {
    const category = matchCategory(field.label)
    if (!category) {
      if (supportsAdditionalAnswer(field) && additionalAnswerFor(field.label, profile)) {
        required.add('autoCompleteFields')
      }
      continue
    }

    if (category === 'resume' && field.type === 'file') {
      if (documents.resume) required.add('autoUploadDocuments')
      continue
    }
    if (category === 'coverLetter') {
      if (field.type === 'file' && documents.coverLetter) required.add('autoUploadDocuments')
      continue
    }
    if (valueForCategory(category, profile)) required.add('autoCompleteFields')
  }

  return [...required]
}

/**
 * Fills standard fields and custom text questions with answers explicitly
 * saved in the profile. Unmatched custom/essay/eligibility questions stay
 * untouched, so the filler never invents a candidate's answer.
 */
export async function fillForm(page: Page, profile: ProfileFields, options: FillFormOptions): Promise<FillFormResult> {
  const fields = await collectFields(page)
  const filledFields: string[] = []
  const skippedFields: string[] = []
  const filledCategories = new Set<FieldCategory>()
  const requiredPermissions = new Set<AgentPermission>()

  for (const field of fields) {
    const category = matchCategory(field.label)
    if (!category) {
      if (!supportsAdditionalAnswer(field)) continue
      const answer = additionalAnswerFor(field.label, profile)
      if (!answer) continue

      try {
        if (!options.allowFieldCompletion) {
          skippedFields.push(`${field.label} (automatic field completion is not allowed)`)
          requiredPermissions.add('autoCompleteFields')
          continue
        }
        await page.locator(field.selector).fill(answer)
        filledFields.push(field.label || 'Additional information')
      } catch (err) {
        skippedFields.push(`${field.label} (failed: ${String(err)})`)
      }
      continue
    }

    // Don't fill the same logical field twice (e.g. two inputs both matching "email").
    if (filledCategories.has(category)) continue

    try {
      if (category === 'resume' && field.type === 'file') {
        if (!options.allowDocumentUploads) {
          skippedFields.push(`${field.label} (automatic document uploads are not allowed)`)
          requiredPermissions.add('autoUploadDocuments')
          continue
        }
        if (!options.resumeFilePath) {
          skippedFields.push(`${field.label} (no resume on file)`)
          continue
        }
        await page.locator(field.selector).setInputFiles(options.resumeFilePath)
        filledFields.push(field.label || 'Resume')
        filledCategories.add(category)
        continue
      }

      if (category === 'coverLetter' && field.type === 'file') {
        if (!options.allowDocumentUploads) {
          skippedFields.push(`${field.label} (automatic document uploads are not allowed)`)
          requiredPermissions.add('autoUploadDocuments')
          continue
        }
        if (!options.coverLetterFilePath) {
          skippedFields.push(`${field.label} (no cover letter on file)`)
          continue
        }
        await page.locator(field.selector).setInputFiles(options.coverLetterFilePath)
        filledFields.push(field.label || 'Cover Letter')
        filledCategories.add(category)
        continue
      }

      if (category === 'coverLetter' && field.tag === 'textarea') {
        // No dedicated cover-letter text to put here without inventing content — skip.
        skippedFields.push(`${field.label} (free-text cover letter, left for you)`)
        continue
      }

      if (!options.allowFieldCompletion) {
        skippedFields.push(`${field.label} (automatic field completion is not allowed)`)
        requiredPermissions.add('autoCompleteFields')
        continue
      }

      const value = valueForCategory(category, profile)
      if (!value) {
        skippedFields.push(`${field.label} (no matching profile data)`)
        continue
      }

      await page.locator(field.selector).fill(value)
      filledFields.push(field.label || category)
      filledCategories.add(category)
    } catch (err) {
      skippedFields.push(`${field.label} (failed: ${String(err)})`)
    }
  }

  return { filledFields, skippedFields, requiredPermissions: [...requiredPermissions] }
}

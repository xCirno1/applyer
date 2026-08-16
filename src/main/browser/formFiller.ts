import type { Page } from 'playwright'
import type { ProfileFields } from '@shared/types/profile'

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

export interface FillFormOptions {
  resumeFilePath?: string
  coverLetterFilePath?: string
}

export interface FillFormResult {
  filledFields: string[]
  skippedFields: string[]
}

/**
 * Fills only well-understood standard fields (name, contact info, links,
 * resume/cover-letter uploads). Deliberately leaves custom/essay/eligibility
 * questions untouched — answering those requires actual judgment about the
 * candidate, which belongs to the agent's reasoning, not a heuristic filler.
 */
export async function fillForm(page: Page, profile: ProfileFields, options: FillFormOptions = {}): Promise<FillFormResult> {
  const fields = await collectFields(page)
  const filledFields: string[] = []
  const skippedFields: string[] = []
  const filledCategories = new Set<FieldCategory>()

  for (const field of fields) {
    const category = matchCategory(field.label)
    if (!category) {
      continue
    }

    // Don't fill the same logical field twice (e.g. two inputs both matching "email").
    if (filledCategories.has(category)) continue

    try {
      if (category === 'resume' && field.type === 'file') {
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

  return { filledFields, skippedFields }
}

// See README.md in this directory: these run inside the page and must stay self-contained.

/** Where to look for each field, first match with content wins. */
export interface PostingSelectors {
  title: string[]
  company: string[]
  location: string[]
  salary: string[]
  /** The container whose innerHTML is the description; it must hold at least `minDescriptionChars` of text. */
  description: string[]
}

export interface PostingDom {
  title: string | null
  company: string | null
  location: string | null
  salary: string | null
  descriptionHtml: string | null
}

/** Every `<script type="application/ld+json">` body on the page, for `parseJobPostingLd`. */
export function collectJsonLdScripts(root?: Document | null): string[] {
  const doc = root ?? document
  const scripts: string[] = []
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
    const body = el.textContent
    if (body && body.trim().length > 0) scripts.push(body)
  })
  return scripts
}

/**
 * Field-by-field selector fallback for a posting page. Shared by the sites
 * whose detail pages are read through the browser, each passing its own
 * selector lists; the JSON-LD block, when the page has one, takes precedence
 * over all of this in the caller.
 */
export function extractPostingDom(selectors: PostingSelectors, root?: Document | null): PostingDom {
  const doc = root ?? document
  const MIN_DESCRIPTION_CHARS = 80

  const firstText = (candidates: string[]): string | null => {
    for (const selector of candidates) {
      let found: Element | null = null
      try {
        found = doc.querySelector(selector)
      } catch {
        continue
      }
      const text = found?.textContent?.replace(/\s+/g, ' ').trim()
      if (text) return text
    }
    return null
  }

  const firstHtml = (candidates: string[]): string | null => {
    for (const selector of candidates) {
      let found: Element | null = null
      try {
        found = doc.querySelector(selector)
      } catch {
        continue
      }
      if (!found) continue
      const textLength = found.textContent?.trim().length ?? 0
      if (textLength >= MIN_DESCRIPTION_CHARS) return found.innerHTML
    }
    return null
  }

  return {
    title: firstText(selectors.title),
    company: firstText(selectors.company),
    location: firstText(selectors.location),
    salary: firstText(selectors.salary),
    descriptionHtml: firstHtml(selectors.description)
  }
}

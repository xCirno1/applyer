// See README.md in this directory: these run inside the page and must stay self-contained.

export interface ProspleCard {
  /** The posting link's href as printed; always contains `/jobs-internships/`. */
  href: string
  title: string | null
  /** The employer's display name when a link to their profile sits in the same card, else null. */
  company: string | null
  location: string | null
  snippet: string | null
  /** Closing date or "Applications close" text as printed, when the card shows one. */
  closes: string | null
}

/**
 * Prosple's search results.
 *
 * Prosple's markup is generated (hashed class names, no test ids), so this
 * anchors on the one thing that is part of the site's information
 * architecture rather than its styling: every posting URL has the shape
 * `/graduate-employers/{employer}/jobs-internships/{slug}`. The card is the
 * nearest list item or article around such a link, and the employer is the
 * sibling link back to `/graduate-employers/{employer}` when there is one.
 * Fields that depend on class names (`location`, the snippet) are read from
 * the loosest selectors that still mean something, and are allowed to be
 * missing.
 */
export function extractProspleSearchCards(root?: Document | null): ProspleCard[] {
  const doc = root ?? document

  const text = (el: Element | null | undefined): string | null => {
    const value = el?.textContent?.replace(/\s+/g, ' ').trim()
    return value ? value : null
  }

  const seen = new Set<string>()
  const cards: ProspleCard[] = []

  doc.querySelectorAll('a[href*="/jobs-internships/"]').forEach((link) => {
    const href = link.getAttribute('href')
    if (!href) return
    const path = href.split('?')[0] ?? href
    if (seen.has(path)) return

    const card = link.closest('li, article, [class*="card"], [class*="Card"], [class*="result"]') ?? link.parentElement
    if (!card) return
    seen.add(path)

    const title = text(link) ?? text(card.querySelector('h2, h3, h4'))

    let company: string | null = null
    card.querySelectorAll('a[href*="/graduate-employers/"]').forEach((employerLink) => {
      if (company) return
      const employerHref = employerLink.getAttribute('href') ?? ''
      if (employerHref.includes('/jobs-internships/')) return
      company = text(employerLink)
    })
    if (!company) {
      company = text(card.querySelector('[class*="employer"], [class*="Employer"], [class*="company"], [class*="Company"]'))
    }

    cards.push({
      href,
      title,
      company,
      location: text(card.querySelector('[class*="location"], [class*="Location"]')),
      snippet: text(card.querySelector('p')),
      closes: text(card.querySelector('[class*="closing"], [class*="Closing"], [class*="deadline"], [class*="Deadline"], time'))
    })
  })

  return cards
}

/**
 * The employer's profile link on a posting page. Prosple's posting pages
 * carry JSON-LD, so this is only read when that block is missing.
 */
export function extractProspleEmployer(root?: Document | null): string | null {
  const doc = root ?? document
  let name: string | null = null
  doc.querySelectorAll('a[href*="/graduate-employers/"]').forEach((link) => {
    if (name) return
    const href = link.getAttribute('href') ?? ''
    if (href.includes('/jobs-internships/')) return
    const value = link.textContent?.replace(/\s+/g, ' ').trim()
    if (value) name = value
  })
  return name
}

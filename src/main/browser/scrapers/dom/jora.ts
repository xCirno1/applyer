// See README.md in this directory: these run inside the page and must stay self-contained.

export interface JoraCard {
  /** The title link's href as printed (relative or absolute); the caller resolves and canonicalises it. */
  href: string | null
  title: string | null
  company: string | null
  location: string | null
  snippet: string | null
  salary: string | null
  /** As printed on the card: "2 days ago", "Today". */
  listed: string | null
}

/**
 * Jora's search results. Jora is a plain server-rendered page with
 * semantically named classes (`job-card`, `job-title`, `job-company`), so
 * those are matched directly, with a heading/link fallback for each field
 * in case one is renamed.
 */
export function extractJoraSearchCards(root?: Document | null): JoraCard[] {
  const doc = root ?? document

  const text = (el: Element | null | undefined): string | null => {
    const value = el?.textContent?.replace(/\s+/g, ' ').trim()
    return value ? value : null
  }

  const cards: JoraCard[] = []
  doc.querySelectorAll('.job-card, article[data-job-id], div[data-job-id]').forEach((card) => {
    const titleLink =
      card.querySelector('.job-title a, a.job-link') ??
      card.querySelector('h2 a[href*="/job/"], h3 a[href*="/job/"], a[href*="/job/"]')
    cards.push({
      href: titleLink?.getAttribute('href') ?? null,
      title: text(titleLink),
      company: text(card.querySelector('.job-company, .company')),
      location: text(card.querySelector('.job-location, .location')),
      snippet: text(card.querySelector('.job-abstract, .abstract, .snippet')),
      salary: text(card.querySelector('.job-salary, .salary')),
      listed: text(card.querySelector('.job-listed-date, .listed-date, time'))
    })
  })
  return cards
}

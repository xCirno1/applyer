// See README.md in this directory: these run inside the page and must stay self-contained.

export interface SeekCard {
  /** Seek's numeric job id, from the card's `data-job-id` or the title link. */
  id: string | null
  title: string | null
  company: string | null
  location: string | null
  snippet: string | null
  salary: string | null
  /** As printed on the card: "3d ago", "Today". */
  listed: string | null
}

/**
 * Seek's search results. Every element on the page carries a
 * `data-automation` attribute meant for Seek's own test suite, which makes
 * them far more stable than the generated class names around them; the
 * bare-tag fallbacks are for the day one of those is renamed.
 */
export function extractSeekSearchCards(root?: Document | null): SeekCard[] {
  const doc = root ?? document

  const text = (el: Element | null | undefined): string | null => {
    const value = el?.textContent?.replace(/\s+/g, ' ').trim()
    return value ? value : null
  }

  const cards: SeekCard[] = []
  doc
    .querySelectorAll('article[data-automation="normalJob"], article[data-automation="premiumJob"], article[data-job-id]')
    .forEach((article) => {
      const titleLink =
        article.querySelector('a[data-automation="jobTitle"]') ?? article.querySelector('h3 a, h2 a, a[href*="/job/"]')
      const href = titleLink?.getAttribute('href') ?? ''
      const idFromHref = href.match(/\/job\/(\d+)/)?.[1] ?? null
      const id = article.getAttribute('data-job-id') ?? idFromHref

      const locations: string[] = []
      article.querySelectorAll('[data-automation="jobLocation"]').forEach((el) => {
        const value = text(el)
        if (value && !locations.includes(value)) locations.push(value)
      })

      cards.push({
        id,
        title: text(titleLink),
        company: text(article.querySelector('[data-automation="jobCompany"]')),
        location: locations.length > 0 ? locations.join(', ') : null,
        snippet: text(article.querySelector('[data-automation="jobShortDescription"]')),
        salary: text(article.querySelector('[data-automation="jobSalary"]')),
        listed: text(article.querySelector('[data-automation="jobListingDate"]'))
      })
    })
  return cards
}

import { readSearchPage } from '../searchPage'
import { SEARCH_COUNTRY_TIME_ZONES, aggregatorHost } from '@shared/types/jobSource'
import { extractSeekSearchCards, type SeekCard } from './dom/seek'
import { relativeListingDate } from './listingDate'
import { readPostingPage } from './postingPage'
import type { AggregatorSearchParams, AggregatorSearchResult, JobDetailsOutcome, JobSearchResultItem } from '../types'

/**
 * Seek: the dominant board in Australia and New Zealand, and nowhere else.
 *
 * Search is `/jobs?keywords=…&where=…` on the country's site (Seek redirects
 * it to its pretty `/{keywords}-jobs/in-{where}` form, which the navigation
 * follows). A posting is `/job/{numeric id}` on the same host, which is the
 * canonical URL Seek itself links to, so that is what results carry rather
 * than the tracking-laden href on the card. Seek has no public search API.
 *
 * Verified against the live site: the search page is server-rendered with
 * `data-automation` attributes on every card field, and it loads without a
 * challenge in the app's headless browser. A posting page's JSON-LD is only
 * a `WebSite` block, so its fields come from the selector fallback.
 */

export function canonicalSeekJobUrl(host: string, id: string): string {
  return `https://${host}/job/${id}`
}

/**
 * A card into a result, or null when the card is missing what a result
 * needs. The URL is built on the host that was searched, so a result from
 * the NZ site links to the NZ site.
 */
export function seekCardToResult(
  card: SeekCard,
  host: string,
  now: Date = new Date(),
  timeZone: string = 'UTC'
): JobSearchResultItem | null {
  if (!card.id || !card.title || !card.company || !/^\d+$/.test(card.id)) return null
  const postedAt = relativeListingDate(card.listed, now, timeZone)
  return {
    title: card.title,
    company: card.company,
    location: card.location ?? undefined,
    url: canonicalSeekJobUrl(host, card.id),
    source: 'seek',
    snippet: card.snippet ?? '',
    ...(postedAt ? { postedAt } : {}),
    ...(card.salary ? { salaryRange: card.salary } : {})
  }
}

export async function searchSeek(params: AggregatorSearchParams): Promise<AggregatorSearchResult> {
  const host = aggregatorHost('seek', params.country)
  if (!host) {
    return { results: [], blocked: false, warning: `seek: no edition for country "${params.country}"` }
  }

  const search = new URLSearchParams({ keywords: params.query })
  if (params.location) search.set('where', params.location)

  const outcome = await readSearchPage({
    source: 'seek',
    host,
    url: `https://${host}/jobs?${search.toString()}`,
    waitFor: 'article[data-automation]',
    read: async (page) => {
      const cards = await page.evaluate(extractSeekSearchCards, null)
      // Seek redirects to a pretty URL and, historically, to a new domain; the
      // host the page landed on is the one a posting link should use.
      const landedHost = new URL(page.url()).hostname || host
      const now = new Date()
      // A promoted posting is listed twice (once in the promoted block, once in
      // its place in the results), so the second copy is dropped by URL.
      const seen = new Set<string>()
      const results: JobSearchResultItem[] = []
      for (const card of cards) {
        const item = seekCardToResult(card, landedHost, now, SEARCH_COUNTRY_TIME_ZONES[params.country])
        if (!item || seen.has(item.url)) continue
        seen.add(item.url)
        results.push(item)
        if (results.length >= params.limit) break
      }
      return results
    }
  })
  if (outcome.status === 'blocked') return { results: [], blocked: true, warning: outcome.warning }

  const results = outcome.value
  if (results.length === 0) {
    return {
      results,
      blocked: false,
      warning: `seek: no listings matched on ${host} (or the page layout was not recognised)`
    }
  }
  return { results, blocked: false }
}

export async function fetchSeekJobDetails(url: string): Promise<JobDetailsOutcome> {
  return readPostingPage(url, {
    label: 'Seek',
    source: 'seek',
    applyMethod: 'external_form',
    waitFor: '[data-automation="jobAdDetails"], h1',
    selectors: {
      title: ['h1[data-automation="job-detail-title"]', 'h1'],
      company: ['[data-automation="advertiser-name"]', '[data-automation="job-detail-company-name"]'],
      location: ['[data-automation="job-detail-location"]'],
      salary: ['[data-automation="job-detail-salary"]'],
      description: ['[data-automation="jobAdDetails"]', '[data-automation="jobDescription"]', 'article', 'main']
    }
  })
}

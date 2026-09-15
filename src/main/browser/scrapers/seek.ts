import { newHeadlessContext } from '../browserController'
import { detectCaptcha } from '../captchaDetector'
import { aggregatorHost } from '@shared/types/jobSource'
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

const NAVIGATION_TIMEOUT_MS = 20000
const SETTLE_TIMEOUT_MS = 6000

export function canonicalSeekJobUrl(host: string, id: string): string {
  return `https://${host}/job/${id}`
}

/**
 * A card into a result, or null when the card is missing what a result
 * needs. The URL is built on the host that was searched, so a result from
 * the NZ site links to the NZ site.
 */
export function seekCardToResult(card: SeekCard, host: string, now: Date = new Date()): JobSearchResultItem | null {
  if (!card.id || !card.title || !card.company || !/^\d+$/.test(card.id)) return null
  const postedAt = relativeListingDate(card.listed, now)
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

  const context = await newHeadlessContext()
  try {
    const page = await context.newPage()
    const search = new URLSearchParams({ keywords: params.query })
    if (params.location) search.set('where', params.location)

    await page.goto(`https://${host}/jobs?${search.toString()}`, {
      waitUntil: 'domcontentloaded',
      timeout: NAVIGATION_TIMEOUT_MS
    })
    await page.waitForSelector('article[data-automation]', { timeout: SETTLE_TIMEOUT_MS }).catch(() => undefined)

    const captcha = await detectCaptcha(page)
    if (captcha.blocked) {
      return { results: [], blocked: true, warning: `seek: blocked by a verification challenge (${captcha.reason})` }
    }

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
      const item = seekCardToResult(card, landedHost, now)
      if (!item || seen.has(item.url)) continue
      seen.add(item.url)
      results.push(item)
      if (results.length >= params.limit) break
    }

    if (results.length === 0) {
      return {
        results,
        blocked: false,
        warning: `seek: no listings matched on ${host} (or the page layout was not recognised)`
      }
    }
    return { results, blocked: false }
  } finally {
    await context.close()
  }
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

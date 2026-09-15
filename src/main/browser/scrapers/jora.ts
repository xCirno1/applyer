import { newHeadlessContext } from '../browserController'
import { detectCaptcha } from '../captchaDetector'
import { SEARCH_COUNTRY_TIME_ZONES, aggregatorHost } from '@shared/types/jobSource'
import { extractJoraSearchCards, type JoraCard } from './dom/jora'
import { relativeListingDate } from './listingDate'
import { readPostingPage } from './postingPage'
import type { AggregatorSearchParams, AggregatorSearchResult, JobDetailsOutcome, JobSearchResultItem } from '../types'

/**
 * Jora: Seek's worldwide aggregator, with an edition in most countries.
 *
 * Jora does not host postings; it re-lists what other boards and career
 * pages publish and links out to them. That makes it the broadest single
 * source here and also the most duplicated one, which is why its adapter is
 * marked `reaggregates` in the registry: a Jora copy of a posting that any
 * other source also returned is dropped in favour of the original.
 *
 * Search is `/j?q=…&l=…`; a posting is `/job/{Title}-{hex id}` and the
 * search links carry tracking parameters, which the canonical URL strips.
 *
 * Verified against the live site: both the search page (`.job-card` with
 * `.job-title`/`.job-company`/`.job-location`) and a posting page (`h1`,
 * `.company`, `.location`, `#job-description-container`) load without a
 * challenge in the app's headless browser. Posting pages carry no JSON-LD,
 * so the selectors are the whole story there.
 */

const NAVIGATION_TIMEOUT_MS = 20000
const SETTLE_TIMEOUT_MS = 6000

/**
 * The posting URL as Jora itself canonicalises it: the `/job/…` path on the
 * edition's host with no query string. Null when the href is not a posting
 * link at all (an ad, a "more jobs like this" link).
 */
export function canonicalJoraJobUrl(href: string, host: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(href, `https://${host}/`)
  } catch {
    return null
  }
  if (!/^\/job\/[^/]+/.test(parsed.pathname)) return null
  return `https://${parsed.hostname}${parsed.pathname}`
}

export function joraCardToResult(
  card: JoraCard,
  host: string,
  now: Date = new Date(),
  timeZone: string = 'UTC'
): JobSearchResultItem | null {
  if (!card.href || !card.title || !card.company) return null
  const url = canonicalJoraJobUrl(card.href, host)
  if (!url) return null
  const postedAt = relativeListingDate(card.listed, now, timeZone)
  return {
    title: card.title,
    company: card.company,
    location: card.location ?? undefined,
    url,
    source: 'jora',
    snippet: card.snippet ?? '',
    ...(postedAt ? { postedAt } : {}),
    ...(card.salary ? { salaryRange: card.salary } : {})
  }
}

export async function searchJora(params: AggregatorSearchParams): Promise<AggregatorSearchResult> {
  const host = aggregatorHost('jora', params.country)
  if (!host) {
    return { results: [], blocked: false, warning: `jora: no edition for country "${params.country}"` }
  }

  const context = await newHeadlessContext()
  try {
    const page = await context.newPage()
    const search = new URLSearchParams({ q: params.query })
    if (params.location) search.set('l', params.location)

    await page.goto(`https://${host}/j?${search.toString()}`, {
      waitUntil: 'domcontentloaded',
      timeout: NAVIGATION_TIMEOUT_MS
    })
    await page.waitForSelector('.job-card, [data-job-id]', { timeout: SETTLE_TIMEOUT_MS }).catch(() => undefined)

    const captcha = await detectCaptcha(page)
    if (captcha.blocked) {
      return { results: [], blocked: true, warning: `jora: blocked by a verification challenge (${captcha.reason})` }
    }

    const cards = await page.evaluate(extractJoraSearchCards, null)
    const now = new Date()
    const seen = new Set<string>()
    const results: JobSearchResultItem[] = []
    for (const card of cards) {
      const item = joraCardToResult(card, host, now, SEARCH_COUNTRY_TIME_ZONES[params.country])
      if (!item || seen.has(item.url)) continue
      seen.add(item.url)
      results.push(item)
      if (results.length >= params.limit) break
    }

    if (results.length === 0) {
      return {
        results,
        blocked: false,
        warning: `jora: no listings matched on ${host} (or the page layout was not recognised)`
      }
    }
    return { results, blocked: false }
  } finally {
    await context.close()
  }
}

export async function fetchJoraJobDetails(url: string): Promise<JobDetailsOutcome> {
  return readPostingPage(url, {
    label: 'Jora',
    source: 'jora',
    // Jora's own "Apply" leads off-site to wherever the posting was found.
    applyMethod: 'external_form',
    waitFor: '#job-description-container, .job-description, h1',
    selectors: {
      title: ['h1.job-title', 'h1'],
      company: ['.job-company', '.company', '[class*="company"]'],
      location: ['.job-location', '.location', '[class*="location"]'],
      salary: ['.job-salary', '.salary', '[class*="salary"]'],
      description: ['#job-description-container', '.job-description', '[class*="description"]', 'article', 'main']
    }
  })
}

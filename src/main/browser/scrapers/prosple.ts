import { newHeadlessContext } from '../browserController'
import { detectCaptcha } from '../captchaDetector'
import { aggregatorHost } from '@shared/types/jobSource'
import { extractProspleEmployer, extractProspleSearchCards, type ProspleCard } from './dom/prosple'
import { readPostingPage } from './postingPage'
import type { AggregatorSearchParams, AggregatorSearchResult, JobDetailsOutcome, JobSearchResultItem } from '../types'

/**
 * Prosple: graduate programs, internships and entry-level roles, one edition
 * per country across Asia-Pacific (GradAustralia, GradNewZealand, and so on).
 *
 * Search is `/search-jobs?keywords=…`. Prosple filters location by opaque
 * region ids rather than by text, so the `location` argument cannot be
 * passed through; it is folded into the keywords instead, which Prosple
 * matches against the posting's location fields as well as its text. A
 * posting is `/graduate-employers/{employer}/jobs-internships/{slug}`; the
 * employer segment is the fallback for the company name when the card does
 * not link to the employer's profile.
 *
 * Prosple sits behind Cloudflare's bot challenge, which answers a headless
 * browser (Playwright's headless shell and Chromium's new headless mode
 * alike) with a "Just a moment..." interstitial and a 403. The captcha
 * detector recognises that page, so a search reports itself as blocked
 * rather than as empty, and the selectors below are the best reading of
 * the site's structure available without a page to check them against.
 * A posting URL still routes here so that a challenge-free fetch (or a
 * future headed/attached-browser path) gets the right adapter.
 */

const NAVIGATION_TIMEOUT_MS = 20000
const SETTLE_TIMEOUT_MS = 8000

const POSTING_PATH = /\/graduate-employers\/([^/]+)\/jobs-internships\/[^/?#]+/

/** "deloitte-australia" as a company name, for a card that shows none: "Deloitte Australia". */
export function companyFromEmployerSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/** The posting URL on the edition's host with no query string, or null when the href is not a posting. */
export function canonicalProspleJobUrl(href: string, host: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(href, `https://${host}/`)
  } catch {
    return null
  }
  const match = parsed.pathname.match(POSTING_PATH)
  if (!match) return null
  return `https://${parsed.hostname}${match[0]}`
}

export function prospleCardToResult(card: ProspleCard, host: string): JobSearchResultItem | null {
  if (!card.title) return null
  const url = canonicalProspleJobUrl(card.href, host)
  if (!url) return null
  const employerSlug = url.match(POSTING_PATH)?.[1]
  const company = card.company ?? (employerSlug ? companyFromEmployerSlug(employerSlug) : null)
  if (!company) return null
  const snippet = [card.snippet, card.closes ? `Closes: ${card.closes}` : null].filter(Boolean).join(' ')
  return {
    title: card.title,
    company,
    location: card.location ?? undefined,
    url,
    source: 'prosple',
    snippet
  }
}

export async function searchProsple(params: AggregatorSearchParams): Promise<AggregatorSearchResult> {
  const host = aggregatorHost('prosple', params.country)
  if (!host) {
    return { results: [], blocked: false, warning: `prosple: no edition for country "${params.country}"` }
  }

  const context = await newHeadlessContext()
  try {
    const page = await context.newPage()
    const keywords = [params.query, params.location].filter(Boolean).join(' ')
    const search = new URLSearchParams({ keywords })

    await page.goto(`https://${host}/search-jobs?${search.toString()}`, {
      waitUntil: 'domcontentloaded',
      timeout: NAVIGATION_TIMEOUT_MS
    })
    await page.waitForSelector('a[href*="/jobs-internships/"]', { timeout: SETTLE_TIMEOUT_MS }).catch(() => undefined)

    const captcha = await detectCaptcha(page)
    if (captcha.blocked) {
      return { results: [], blocked: true, warning: `prosple: blocked by a verification challenge (${captcha.reason})` }
    }

    const cards = await page.evaluate(extractProspleSearchCards, null)
    const results = cards
      .map((card) => prospleCardToResult(card, host))
      .filter((item): item is JobSearchResultItem => item !== null)
      .slice(0, params.limit)

    if (results.length === 0) {
      return {
        results,
        blocked: false,
        warning: `prosple: no listings matched on ${host} (or the page layout was not recognised)`
      }
    }
    return { results, blocked: false }
  } finally {
    await context.close()
  }
}

export async function fetchProspleJobDetails(url: string): Promise<JobDetailsOutcome> {
  const employerSlug = url.match(POSTING_PATH)?.[1]
  return readPostingPage(url, {
    label: 'Prosple',
    source: 'prosple',
    // Prosple's "Apply" is a redirect to the employer's own application page.
    applyMethod: 'external_form',
    waitFor: 'h1',
    selectors: {
      title: ['h1'],
      company: ['[class*="employer-name"]', '[class*="EmployerName"]'],
      location: ['[class*="location"]', '[class*="Location"]'],
      salary: ['[class*="salary"]', '[class*="Salary"]'],
      description: ['[class*="description"]', '[class*="Description"]', 'article', 'main']
    },
    companyFallback: async (page) => {
      const linked = await page.evaluate(extractProspleEmployer, null)
      if (linked) return linked
      return employerSlug ? companyFromEmployerSlug(employerSlug) : null
    }
  })
}

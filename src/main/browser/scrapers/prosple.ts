import { readSearchPage } from '../searchPage'
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
 * Prosple sits behind Cloudflare's managed challenge, which answers a
 * headless browser (Playwright's headless shell and Chromium's new
 * headless mode alike, with or without a real-looking user agent, and
 * even carrying a clearance cookie a real window earned) with a "Just a
 * moment..." interstitial and a 403, and clears the same page in a visible
 * window within seconds. So a Prosple search is, in practice, always the
 * challenge fallback in `searchPage.ts`: the headless attempt reports
 * blocked, the page is opened in the application browser, and the user is
 * asked to look at it while it clears. The selectors below were checked
 * against the live site through that window.
 */

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

  const keywords = [params.query, params.location].filter(Boolean).join(' ')
  const search = new URLSearchParams({ keywords })

  const outcome = await readSearchPage({
    source: 'prosple',
    host,
    url: `https://${host}/search-jobs?${search.toString()}`,
    waitFor: 'a[href*="/jobs-internships/"]',
    read: async (page) => {
      const cards = await page.evaluate(extractProspleSearchCards, null)
      return cards
        .map((card) => prospleCardToResult(card, host))
        .filter((item): item is JobSearchResultItem => item !== null)
        .slice(0, params.limit)
    }
  })
  if (outcome.status === 'blocked') return { results: [], blocked: true, warning: outcome.warning }

  const results = outcome.value
  if (results.length === 0) {
    return {
      results,
      blocked: false,
      warning: `prosple: no listings matched on ${host} (or the page layout was not recognised)`
    }
  }
  return { results, blocked: false }
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

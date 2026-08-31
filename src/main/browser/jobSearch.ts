import { searchIndeed } from './scrapers/indeed'
import { searchLinkedIn } from './scrapers/linkedin'
import { searchAtsBoards } from './ats/searchAtsBoards'
import { crossSourceKey, interleaveByBoard } from './ats/matching'
import { isUrlExcluded } from '../db/repositories/jobExclusionsRepository'
import { ATS_PROVIDERS, type AtsProvider } from '@shared/types/companyBoard'
import type { JobSearchResultItem } from './types'
import type { JobSource } from './sourceRouter'

export interface SearchJobsParams {
  query: string
  location?: string
  sources?: JobSource[]
  limit: number
}

export interface SearchJobsOutcome {
  results: JobSearchResultItem[]
  searchedSources: string[]
  warnings: string[]
}

/** Cross-company keyword search, scraped from a rendered page. */
const AGGREGATOR_SOURCES: JobSource[] = ['indeed', 'linkedin']

/**
 * Per-company ATS boards. None of these has a cross-company search endpoint,
 * so they're searched by fetching the boards of the companies the user (or
 * the agent) asked to track and filtering locally — see
 * `ats/searchAtsBoards.ts`. Asking for one of them with nothing tracked
 * returns a warning saying so rather than silently no results.
 */
const ATS_SOURCES: JobSource[] = [...ATS_PROVIDERS]

/**
 * `generic` stays out: it's the fallback for an arbitrary careers page and
 * has nothing to enumerate, so `get_job_details` on a specific URL is the
 * only thing that makes sense for it.
 */
const SEARCHABLE_SOURCES: JobSource[] = [...AGGREGATOR_SOURCES, ...ATS_SOURCES]

function isAtsSource(source: JobSource): source is AtsProvider {
  return (ATS_SOURCES as string[]).includes(source)
}

export async function searchJobs(params: SearchJobsParams): Promise<SearchJobsOutcome> {
  const requested = params.sources && params.sources.length > 0 ? params.sources : SEARCHABLE_SOURCES
  const toSearch = requested.filter((s) => SEARCHABLE_SOURCES.includes(s))
  const warnings: string[] = []

  for (const source of requested) {
    if (!SEARCHABLE_SOURCES.includes(source)) {
      warnings.push(
        `${source}: no keyword-search endpoint exists for this source — pass a specific company's job/career-page URL to get_job_details instead.`
      )
    }
  }

  const searchedSources: string[] = []
  // Held per source rather than appended to one list as each finishes, so the
  // final ordering doesn't depend on which network call returned first.
  let indeedResults: JobSearchResultItem[] = []
  let linkedinResults: JobSearchResultItem[] = []
  let atsResults: JobSearchResultItem[] = []

  const tasks: Promise<void>[] = []

  if (toSearch.includes('indeed')) {
    tasks.push(
      (async () => {
        const result = await searchIndeed(params.query, params.location, params.limit)
        searchedSources.push('indeed')
        if (result.warning) warnings.push(result.warning)
        indeedResults = result.results
      })()
    )
  }

  if (toSearch.includes('linkedin')) {
    tasks.push(
      (async () => {
        const result = await searchLinkedIn(params.query, params.location, params.limit)
        searchedSources.push('linkedin')
        if (result.warning) warnings.push(result.warning)
        linkedinResults = result.results
      })()
    )
  }

  // All four ATS providers go through one call: the work is per *board*, not
  // per provider, so doing it once lets the concurrency cap apply across the
  // whole watchlist instead of four times over.
  const atsProviders = toSearch.filter(isAtsSource)
  if (atsProviders.length > 0) {
    tasks.push(
      (async () => {
        const result = await searchAtsBoards({
          query: params.query,
          location: params.location,
          limit: params.limit,
          providers: atsProviders
        })
        searchedSources.push(...result.searchedProviders)
        warnings.push(...result.warnings)
        atsResults = result.results
      })()
    )
  }

  const settled = await Promise.allSettled(tasks)
  for (const outcome of settled) {
    if (outcome.status === 'rejected') {
      warnings.push(`A search source failed unexpectedly: ${String(outcome.reason)}`)
    }
  }

  const seenUrls = new Set<string>()
  const keep = (result: JobSearchResultItem): boolean => {
    if (seenUrls.has(result.url)) return false
    if (isUrlExcluded(result.url)) return false
    seenUrls.add(result.url)
    return true
  }

  const keptAts = atsResults.filter(keep)

  /**
   * A posting reached through the company's own board is the better copy of
   * the same job: canonical URL, no login wall, and a fill path that already
   * works. The two copies have different URLs and no shared id, so company +
   * title + location is the only handle on the fact that they're one job.
   *
   * Deliberately one-directional — aggregator rows are matched against the
   * ATS set but never added to it. Two aggregator listings that happen to
   * share a company, title and location are often genuinely different
   * requisitions, and collapsing those would hide real postings.
   */
  const atsIdentities = new Set(keptAts.map((r) => crossSourceKey(r.company, r.title, r.location)))
  const keptAggregators = [...indeedResults, ...linkedinResults].filter(
    (result) => !atsIdentities.has(crossSourceKey(result.company, result.title, result.location)) && keep(result)
  )

  // Interleaved rather than concatenated: the ATS boards are the precise
  // source and the aggregators are the broad one, and letting either fill the
  // whole page defeats the point of running both.
  const results = interleaveByBoard([keptAts, keptAggregators], params.limit)

  return { results, searchedSources, warnings }
}

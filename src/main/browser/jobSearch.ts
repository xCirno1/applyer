import { searchIndeed } from './scrapers/indeed'
import { searchLinkedIn } from './scrapers/linkedin'
import { isUrlExcluded } from '../db/repositories/jobExclusionsRepository'
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

/**
 * Indeed and LinkedIn are the only sources here with an actual cross-company
 * keyword search. Greenhouse/Lever/Ashby/Workday are per-company job boards
 * with no aggregate search endpoint — asking for one of those alone returns
 * a clear warning instead of pretending to search something that doesn't
 * exist. get_job_details can still fetch any of them once a URL is known.
 */
const SEARCHABLE_SOURCES: JobSource[] = ['indeed', 'linkedin']

export async function searchJobs(params: SearchJobsParams): Promise<SearchJobsOutcome> {
  const requested = params.sources && params.sources.length > 0 ? params.sources : SEARCHABLE_SOURCES
  const toSearch = requested.filter((s) => SEARCHABLE_SOURCES.includes(s))
  const warnings: string[] = []

  for (const source of requested) {
    if (!SEARCHABLE_SOURCES.includes(source)) {
      warnings.push(
        `${source}: no keyword-search endpoint exists for this source (it's a per-company job board) — pass a specific company's job/career-page URL to get_job_details instead.`
      )
    }
  }

  const searchedSources: string[] = []
  const allResults: JobSearchResultItem[] = []

  const tasks = toSearch.map(async (source) => {
    if (source === 'indeed') {
      const result = await searchIndeed(params.query, params.location, params.limit)
      searchedSources.push('indeed')
      if (result.warning) warnings.push(result.warning)
      return result.results
    }
    if (source === 'linkedin') {
      const result = await searchLinkedIn(params.query, params.location, params.limit)
      searchedSources.push('linkedin')
      if (result.warning) warnings.push(result.warning)
      return result.results
    }
    return []
  })

  const settled = await Promise.allSettled(tasks)
  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') {
      allResults.push(...outcome.value)
    } else {
      warnings.push(`A search source failed unexpectedly: ${String(outcome.reason)}`)
    }
  }

  const seen = new Set<string>()
  const deduped = allResults.filter((r) => {
    if (seen.has(r.url)) return false
    seen.add(r.url)
    return !isUrlExcluded(r.url)
  })

  return {
    results: deduped.slice(0, params.limit),
    searchedSources,
    warnings
  }
}

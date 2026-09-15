import { AGGREGATORS, type AggregatorAdapter } from './aggregators'
import { searchAtsBoards } from './ats/searchAtsBoards'
import { crossSourceKey, interleaveByBoard } from './ats/matching'
import { isUrlExcluded } from '../db/repositories/jobExclusionsRepository'
import { ATS_PROVIDERS, type AtsProvider } from '@shared/types/companyBoard'
import {
  DEFAULT_SEARCH_COUNTRY,
  SEARCHABLE_SOURCES,
  aggregatorServesCountry,
  type JobSource,
  type SearchCountry
} from '@shared/types/jobSource'
import type { JobSearchResultItem } from './types'

export interface SearchJobsParams {
  query: string
  location?: string
  sources?: JobSource[]
  limit: number
  /** Which national edition of each aggregator to search; the caller resolves the setting. */
  country?: SearchCountry
}

/** What one site did in a search, before cross-source dedupe, for the run statistics. */
export interface SearchSourceOutcome {
  /** Rows the site returned on its own, before dedupe against the other sites. */
  results: number
  /** The site answered with a verification challenge. */
  blocked: boolean
  /** The site came back with a warning (empty page, unrecognised layout, a board that could not be fetched). */
  warned: boolean
}

export interface SearchJobsOutcome {
  results: JobSearchResultItem[]
  searchedSources: string[]
  warnings: string[]
  /** Per searched source; the ATS providers are one entry each, with their boards' rows summed. */
  sourceOutcomes: Record<string, SearchSourceOutcome>
}

/**
 * Two kinds of source. The aggregators (`AGGREGATORS`) each have a
 * cross-company keyword search of their own. The ATS providers do not: they
 * are searched by fetching the boards of the companies the user (or the
 * agent) asked to track and filtering locally, see `ats/searchAtsBoards.ts`,
 * and asking for one with nothing tracked returns a warning saying so rather
 * than silently no results.
 */
const ATS_SOURCES: readonly JobSource[] = ATS_PROVIDERS

function isAtsSource(source: JobSource): source is AtsProvider {
  return ATS_SOURCES.includes(source)
}

export async function searchJobs(params: SearchJobsParams): Promise<SearchJobsOutcome> {
  const country = params.country ?? DEFAULT_SEARCH_COUNTRY
  const explicitSources = params.sources && params.sources.length > 0 ? params.sources : null
  const explicit = explicitSources !== null
  const requested: readonly JobSource[] = explicitSources ?? SEARCHABLE_SOURCES
  const warnings: string[] = []

  for (const source of requested) {
    if (!SEARCHABLE_SOURCES.includes(source)) {
      warnings.push(
        `${source}: no keyword-search endpoint exists for this source; pass a specific company's job/career-page URL to get_job_details instead.`
      )
    }
  }

  // An aggregator with no edition in this country is skipped. That is only
  // worth a warning when the agent asked for it by name: on a default
  // "everything" search from, say, Germany, "seek: not available" on every
  // call would be noise about a site the user never mentioned.
  const aggregators: AggregatorAdapter[] = []
  for (const adapter of AGGREGATORS) {
    if (!requested.includes(adapter.source)) continue
    if (aggregatorServesCountry(adapter.source, country)) {
      aggregators.push(adapter)
    } else if (explicit) {
      warnings.push(`${adapter.source}: no edition for country "${country}"; change the job search country in Settings or pass a country that it serves.`)
    }
  }

  const searchedSources: string[] = []
  const sourceOutcomes: Record<string, SearchSourceOutcome> = {}
  // Held per source rather than appended to one list as each finishes, so the
  // final ordering doesn't depend on which network call returned first.
  const aggregatorResults = new Map<JobSource, JobSearchResultItem[]>()
  let atsResults: JobSearchResultItem[] = []

  const tasks: Promise<void>[] = []

  for (const adapter of aggregators) {
    tasks.push(
      (async () => {
        const result = await adapter.search({
          query: params.query,
          location: params.location,
          limit: params.limit,
          country
        })
        searchedSources.push(adapter.source)
        if (result.warning) warnings.push(result.warning)
        aggregatorResults.set(adapter.source, result.results)
        sourceOutcomes[adapter.source] = {
          results: result.results.length,
          blocked: result.blocked,
          warned: result.warning !== undefined
        }
      })()
    )
  }

  // All four ATS providers go through one call: the work is per *board*, not
  // per provider, so doing it once lets the concurrency cap apply across the
  // whole watchlist instead of four times over.
  const atsProviders = requested.filter(isAtsSource)
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
        for (const provider of result.searchedProviders) {
          sourceOutcomes[provider] = {
            results: result.results.filter((row) => row.source === provider).length,
            blocked: false,
            warned: result.warnings.some((warning) => warning.includes(`(${provider})`))
          }
        }
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
   * Deliberately one-directional between the ATS set and the aggregators,
   * and not applied between two aggregators that host their own postings:
   * two such listings that happen to share a company, title and location
   * are often genuinely different requisitions, and collapsing those would
   * hide real postings. The one exception is a re-aggregator (see
   * `AggregatorAdapter.reaggregates`), whose rows are by definition copies
   * of something another site published, so its copy loses to any other
   * source's, including another aggregator's.
   */
  const identity = (r: JobSearchResultItem): string => crossSourceKey(r.company, r.title, r.location)
  const atsIdentities = new Set(keptAts.map(identity))
  const hostedIdentities = new Set<string>()

  // Hosting sites are filtered first so that a re-aggregator's rows can be
  // checked against everything they might be copies of, then the per-source
  // lists are assembled in registry order so the interleave below is stable.
  const hostedKept = new Map<JobSource, JobSearchResultItem[]>()
  for (const adapter of aggregators) {
    if (adapter.reaggregates) continue
    const rows = aggregatorResults.get(adapter.source) ?? []
    const kept = rows.filter((result) => !atsIdentities.has(identity(result)) && keep(result))
    for (const row of kept) hostedIdentities.add(identity(row))
    hostedKept.set(adapter.source, kept)
  }
  const keptPerAggregator = aggregators.map((adapter) => {
    if (!adapter.reaggregates) return hostedKept.get(adapter.source) ?? []
    return (aggregatorResults.get(adapter.source) ?? []).filter((result) => {
      const key = identity(result)
      return !atsIdentities.has(key) && !hostedIdentities.has(key) && keep(result)
    })
  })

  // Interleaved rather than concatenated, at two levels. The ATS boards are
  // the precise source and the aggregators are the broad one, so each side
  // gets half the page; within the aggregator half, the sites take turns so
  // that the one with the most results does not fill it alone.
  const aggregatorsMerged = interleaveByBoard(keptPerAggregator, params.limit)
  const results = interleaveByBoard([keptAts, aggregatorsMerged], params.limit)

  return { results, searchedSources, warnings, sourceOutcomes }
}

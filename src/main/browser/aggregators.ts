import { searchIndeed } from './scrapers/indeed'
import { searchLinkedIn } from './scrapers/linkedin'
import { searchSeek } from './scrapers/seek'
import { searchJora } from './scrapers/jora'
import { searchProsple } from './scrapers/prosple'
import { searchRemotive } from './scrapers/remotive'
import type { AggregatorSearchParams, AggregatorSearchResult } from './types'
import type { AggregatorSource } from '@shared/types/jobSource'

/**
 * The cross-company search sources, in the order their results are
 * interleaved (see `jobSearch.ts`). One entry per aggregator, so adding a
 * site is one scraper module and one line here rather than another copy of
 * the search/collect/merge block.
 */
export interface AggregatorAdapter {
  source: AggregatorSource
  /**
   * True for a site that re-lists other boards' postings rather than hosting
   * its own (Jora). Its copy of a posting is the worst one to keep: the URL
   * is a redirect to wherever the posting really lives, so when any other
   * source returned the same job, the re-aggregator's row is dropped.
   */
  reaggregates?: boolean
  search: (params: AggregatorSearchParams) => Promise<AggregatorSearchResult>
}

export const AGGREGATORS: readonly AggregatorAdapter[] = [
  { source: 'indeed', search: searchIndeed },
  { source: 'linkedin', search: searchLinkedIn },
  { source: 'seek', search: searchSeek },
  { source: 'jora', reaggregates: true, search: searchJora },
  { source: 'prosple', search: searchProsple },
  { source: 'remotive', search: searchRemotive }
]

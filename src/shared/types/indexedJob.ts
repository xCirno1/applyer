import type { JobStatus } from './job'

export interface IndexedJobRecord {
  id: string
  url: string
  title: string
  company: string
  location: string | null
  source: string | null
  snippet: string | null
  salaryRange: string | null
  postedAt: string | null
  searchQuery: string
  searchLocation: string | null
  firstSeenAt: string
  lastSeenAt: string
  seenCount: number
  matchedJobId: string | null
  matchedStatus: JobStatus | null
  matchedScore: number | null
}

export type IndexedJobMatchFilter = 'all' | 'matched' | 'unmatched'

export interface ListIndexedJobsQuery {
  limit?: number
  offset?: number
  search?: string
  source?: string
  matched?: IndexedJobMatchFilter
}

export interface ListIndexedJobsResult {
  items: IndexedJobRecord[]
  total: number
}

/** Days to retain an indexed-job row since it was last seen, or `'unlimited'` to never prune. */
export type IndexedJobsRetention = number | 'unlimited'

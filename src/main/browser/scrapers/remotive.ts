import { fetchAtsJson } from '../ats/http'
import { normalizeText, queryTerms, rankPostings } from '../ats/matching'
import type { AtsPosting } from '../ats/types'
import { htmlToPlainText, sanitizeDescriptionHtml } from '../htmlContent'
import { fetchGenericJobDetails } from './generic'
import type { AggregatorSearchParams, AggregatorSearchResult, JobDetailsOutcome, JobSearchResultItem } from '../types'

/**
 * Remotive: a curated board of remote-only roles with a public, keyless JSON
 * API (`/api/remote-jobs`), which is why it is here at all. No browser, no
 * captcha surface, no markup to drift: the same footing as the ATS boards.
 *
 * The API comes with terms in its own response body: link back to the
 * posting on Remotive, name Remotive as the source, and call it a few times
 * a day at most ("we advise max. 4 times a day"), since the feed is delayed
 * by a day anyway. So this adapter never queries the API per search. It
 * fetches the whole feed (a couple of thousand postings, a few megabytes)
 * once, keeps it for `FEED_TTL_MS`, and answers every search and every
 * `get_job_details` from that copy with the same local matching the ATS
 * boards use. The first search of a session pays for the download; the rest
 * are free.
 *
 * Remote-only cuts both ways. There is no country edition and no location
 * filter; what a posting has is `candidate_required_location` ("Worldwide",
 * "USA only", "Europe"), so a `location` argument is used to rank rather
 * than filter, with the postings that name it (or say "worldwide") first.
 */

const API_URL = 'https://remotive.com/api/remote-jobs'
const SNIPPET_CHARS = 240
/** Six hours is four fetches a day, the ceiling Remotive's notice asks for. */
const FEED_TTL_MS = 6 * 60 * 60 * 1000
/** A feed that failed to load is retried sooner than a good one is refreshed, but not on every call. */
const FEED_ERROR_TTL_MS = 5 * 60 * 1000

export interface RemotiveJob {
  id: number
  url: string
  title: string
  company: string
  category: string | null
  tags: string[]
  location: string | null
  publishedAt: string | null
  salary: string | null
  descriptionHtml: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/**
 * The jobs in an API response that are well-formed enough to use. A posting
 * missing its id, URL, title or company is skipped rather than failing the
 * whole feed; the API is public and its shape is not ours to rely on.
 */
export function parseRemotiveJobs(data: unknown): RemotiveJob[] {
  if (!isRecord(data) || !Array.isArray(data.jobs)) return []
  const jobs: RemotiveJob[] = []
  for (const entry of data.jobs) {
    if (!isRecord(entry)) continue
    const id = typeof entry.id === 'number' && Number.isSafeInteger(entry.id) ? entry.id : null
    const url = optionalString(entry.url)
    const title = optionalString(entry.title)
    const company = optionalString(entry.company_name)
    if (id === null || !url || !title || !company) continue
    jobs.push({
      id,
      url,
      title,
      company,
      category: optionalString(entry.category),
      tags: Array.isArray(entry.tags) ? entry.tags.filter((tag): tag is string => typeof tag === 'string') : [],
      location: optionalString(entry.candidate_required_location),
      publishedAt: optionalString(entry.publication_date),
      salary: optionalString(entry.salary),
      descriptionHtml: typeof entry.description === 'string' ? entry.description : ''
    })
  }
  return jobs
}

interface FeedCache {
  fetchedAt: number
  jobs: RemotiveJob[]
  /** Set when the last fetch failed; the cache then expires after `FEED_ERROR_TTL_MS` instead. */
  error: string | null
}

let feedCache: FeedCache | null = null
let feedInFlight: Promise<FeedCache> | null = null

/** Tests only: forget the cached feed so the next call fetches again. */
export function resetRemotiveFeedCache(): void {
  feedCache = null
  feedInFlight = null
}

async function loadFeed(now: number): Promise<FeedCache> {
  const outcome = await fetchAtsJson(API_URL)
  if (outcome.status === 'not_found') return { fetchedAt: now, jobs: [], error: 'the API endpoint was not found' }
  if (outcome.status === 'error') return { fetchedAt: now, jobs: [], error: outcome.message }
  return { fetchedAt: now, jobs: parseRemotiveJobs(outcome.data), error: null }
}

/**
 * The cached feed, refreshed when stale. Concurrent callers during a refresh
 * share one request: a default search runs this adapter alongside five
 * others, and two searches in quick succession must not become two
 * downloads of the same feed.
 */
async function getFeed(now: number = Date.now()): Promise<FeedCache> {
  if (feedCache) {
    const ttl = feedCache.error ? FEED_ERROR_TTL_MS : FEED_TTL_MS
    if (now - feedCache.fetchedAt < ttl) return feedCache
  }
  if (!feedInFlight) {
    feedInFlight = loadFeed(now)
      .then((cache) => {
        feedCache = cache
        return cache
      })
      .finally(() => {
        feedInFlight = null
      })
  }
  return feedInFlight
}

/** The shape the ATS matching helpers rank; category and tags stand in for department and team. */
function toPosting(job: RemotiveJob): AtsPosting {
  return {
    id: String(job.id),
    title: job.title,
    company: job.company,
    location: job.location ?? undefined,
    department: job.category ?? undefined,
    team: job.tags.join(' '),
    isRemote: true,
    url: job.url,
    postedAt: job.publishedAt ?? undefined,
    salaryRange: job.salary ?? undefined,
    snippet: ''
  }
}

/**
 * Postings whose required location names the asked-for place, or is open
 * to anyone, ahead of the rest. A stable partition rather than a sort so
 * that within each group the ranking order survives.
 */
export function rankByLocation(jobs: readonly RemotiveJob[], location: string | undefined): RemotiveJob[] {
  const terms = location ? queryTerms(location) : []
  if (terms.length === 0) return [...jobs]
  const matches = (job: RemotiveJob): boolean => {
    const required = normalizeText(job.location ?? '')
    if (!required || required === 'worldwide' || required === 'anywhere') return true
    return terms.some((term) => ` ${required} `.includes(` ${term} `))
  }
  return [...jobs.filter(matches), ...jobs.filter((job) => !matches(job))]
}

/** Query-matched postings, best first, then the location preference applied. */
export function searchRemotiveFeed(
  jobs: readonly RemotiveJob[],
  query: string,
  location: string | undefined,
  now = Date.now()
): RemotiveJob[] {
  const byId = new Map(jobs.map((job) => [String(job.id), job]))
  const ranked = rankPostings(jobs.map(toPosting), queryTerms(query), undefined, now)
  const matched = ranked.map((posting) => byId.get(posting.id)).filter((job): job is RemotiveJob => job !== undefined)
  return rankByLocation(matched, location)
}

function snippetOf(job: RemotiveJob): string {
  const text = htmlToPlainText(job.descriptionHtml).replace(/\s+/g, ' ').trim()
  return text.length > SNIPPET_CHARS ? `${text.slice(0, SNIPPET_CHARS - 1)}…` : text
}

function toResult(job: RemotiveJob): JobSearchResultItem {
  return {
    title: job.title,
    company: job.company,
    location: job.location ?? 'Remote',
    url: job.url,
    source: 'remotive',
    snippet: snippetOf(job),
    ...(job.publishedAt ? { postedAt: job.publishedAt } : {}),
    ...(job.salary ? { salaryRange: job.salary } : {})
  }
}

export async function searchRemotive(params: AggregatorSearchParams): Promise<AggregatorSearchResult> {
  const feed = await getFeed()
  if (feed.error) {
    return { results: [], blocked: false, warning: `remotive: ${feed.error}` }
  }
  const results = searchRemotiveFeed(feed.jobs, params.query, params.location).slice(0, params.limit).map(toResult)
  return { results, blocked: false }
}

/** The numeric id Remotive appends to every posting slug. */
export function parseRemotiveJobId(url: string): number | null {
  let pathname: string
  try {
    pathname = new URL(url).pathname
  } catch {
    return null
  }
  const match = pathname.match(/\/remote-jobs\/[^/]+\/[^/]+-(\d+)\/?$/)
  if (!match) return null
  const id = Number.parseInt(match[1]!, 10)
  return Number.isSafeInteger(id) ? id : null
}

export async function fetchRemotiveJobDetails(url: string): Promise<JobDetailsOutcome> {
  const id = parseRemotiveJobId(url)
  if (id !== null) {
    const feed = await getFeed()
    const job = feed.jobs.find((candidate) => candidate.id === id)
    if (job && job.descriptionHtml.trim().length > 0) {
      const html = sanitizeDescriptionHtml(job.descriptionHtml)
      return {
        status: 'ok',
        details: {
          title: job.title,
          company: job.company,
          location: job.location ?? 'Remote',
          description: html,
          descriptionText: htmlToPlainText(html),
          applicationUrl: job.url,
          detectedAts: 'remotive',
          requiresLogin: false,
          applyMethod: 'external_form',
          ...(job.salary ? { salaryRange: job.salary } : {})
        }
      }
    }
  }
  // A posting newer than the cached feed, one that has since closed, or a
  // URL with no id in it: the page itself is the only remaining source.
  return fetchGenericJobDetails(url)
}

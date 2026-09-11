import { fetchAtsJson } from '../http'
import { asArray, asRecord, asString, safeHttpUrl, toIsoTimestamp, toSnippet } from './shared'
import type { AtsBoardDescriptor } from '@shared/types/companyBoard'
import type { AtsBoardFetchOutcome, AtsPosting, AtsProviderAdapter } from '../types'

const HOSTS = ['jobs.ashbyhq.com', 'api.ashbyhq.com']

/**
 * The REST posting API, not the GraphQL endpoint most write-ups point at —
 * this one is a plain GET and returns the same board.
 */
function boardUrl(token: string): string {
  return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}?includeCompensation=true`
}

/**
 * Ashby is the one board that hands over a rendered range rather than raw
 * numbers (`"$211.4K – $290.6K"`), so there is nothing to reformat and
 * nothing to guess about the period.
 */
function salary(posting: Record<string, unknown>): string | undefined {
  const compensation = asRecord(posting.compensation)
  if (!compensation) return undefined
  return (
    asString(compensation.scrapeableCompensationSalarySummary) ??
    asString(compensation.compensationTierSummary)
  )
}

/** Secondary locations are where a "one role, many cities" posting keeps the rest of its cities. */
function locationText(posting: Record<string, unknown>): string | undefined {
  const primary = asString(posting.location)
  const secondary = asArray(posting.secondaryLocations)
    .map((entry) => asString(asRecord(entry)?.location))
    .filter((value): value is string => !!value)

  if (!primary && secondary.length === 0) return undefined
  return [primary, ...secondary].filter(Boolean).join(', ')
}

function toPosting(raw: unknown, fallbackCompany: string): AtsPosting | null {
  const posting = asRecord(raw)
  if (!posting) return null

  const id = asString(posting.id)
  const title = asString(posting.title)
  if (!id || !title) return null

  const url = safeHttpUrl(posting.jobUrl) ?? safeHttpUrl(posting.applyUrl)
  if (!url) return null

  return {
    id,
    title,
    // Same as Lever: the payload never names the company.
    company: fallbackCompany,
    location: locationText(posting),
    department: asString(posting.department),
    team: asString(posting.team),
    employmentType: asString(posting.employmentType),
    isRemote: typeof posting.isRemote === 'boolean' ? posting.isRemote : undefined,
    url,
    postedAt: toIsoTimestamp(posting.publishedAt),
    salaryRange: salary(posting),
    snippet: toSnippet(asString(posting.descriptionPlain) ?? asString(posting.descriptionHtml), !posting.descriptionPlain)
  }
}

export const ashbyAdapter: AtsProviderAdapter = {
  provider: 'ashby',
  label: 'Ashby',
  serverSideQuery: false,
  probeable: true,

  async fetchBoard(descriptor, options): Promise<AtsBoardFetchOutcome> {
    const outcome = await fetchAtsJson(boardUrl(descriptor.token), { timeoutMs: options.timeoutMs })
    if (outcome.status !== 'ok') return outcome

    const body = asRecord(outcome.data)
    if (!body || !Array.isArray(body.jobs)) {
      return { status: 'error', message: 'Ashby response had no jobs array' }
    }

    const postings: AtsPosting[] = []
    let skipped = 0
    for (const raw of body.jobs) {
      // `isListed: false` is a posting the company has taken off its own
      // board — dropped rather than counted as malformed.
      if (asRecord(raw)?.isListed === false) continue
      const posting = toPosting(raw, options.companyName)
      if (posting) postings.push(posting)
      else skipped++
    }
    return { status: 'ok', postings, skipped }
  },

  parseBoardUrl(url: URL): AtsBoardDescriptor | null {
    if (!HOSTS.includes(url.hostname.toLowerCase())) return null
    const segments = url.pathname.split('/').filter(Boolean)
    // Public: /{token}[/{postingId}]. API: /posting-api/job-board/{token}.
    const token = segments[0] === 'posting-api' && segments[1] === 'job-board' ? segments[2] : segments[0]
    if (!token) return null
    return { provider: 'ashby', token, host: null, site: null }
  }
}

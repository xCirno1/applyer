import { fetchAtsJson } from '../http'
import { asArray, asFiniteNumber, asRecord, asString, toSnippet } from './shared'
import type { AtsBoardDescriptor } from '@shared/types/companyBoard'
import type { AtsBoardFetchOutcome, AtsPosting, AtsProviderAdapter, FetchBoardOptions } from '../types'

/**
 * Workday doesn't fit the "one bare token on a fixed host" model the other
 * three share. Its list endpoint is a POST to
 * `https://{host}/wday/cxs/{tenant}/{site}/jobs` with a `{limit, offset,
 * searchText}` body, so a board needs a data-centre host, a tenant *and* a
 * career-site id. None of those three can be guessed from a company name,
 * which is why this provider is not probeable: a Workday board can only be
 * added by pasting one of its URLs.
 *
 * The upside is that it is the only one of the four that filters server-side,
 * so the query goes to Workday rather than being applied locally to a whole
 * board — which matters, since a large tenant has thousands of postings.
 */

/**
 * Hard cap, not a preference: `limit: 100` comes back as an object with
 * neither `total` nor `jobPostings` (measured against a live tenant), i.e. a
 * silently empty result rather than an error. 20 is what the endpoint serves.
 */
const PAGE_SIZE = 20

/** Politeness bound — three sequential pages is 60 postings, far more than a search shows. */
const MAX_PAGES = 3

/** An unknown career site answers 404; an unknown tenant answers 422. Both mean "no such board". */
const NOT_FOUND_STATUSES = [422]

/** Every Workday career site lives under this domain; nothing else is one. */
export const WORKDAY_HOST_SUFFIX = '.myworkdayjobs.com'

/**
 * Whether a stored host is really a Workday one.
 *
 * A board's host is the only field in this app that becomes the *authority*
 * of an outbound request, and rows do not only arrive from `parseBoardUrl`:
 * an imported bundle is a file, and a file is whatever someone made it. This
 * is checked again at the point of use, so a row that got past validation
 * — an older row, a hand-edited database — still cannot aim a request
 * somewhere of its choosing.
 */
export function isWorkdayHost(host: string | null): host is string {
  if (!host) return false
  const lower = host.toLowerCase()
  if (!lower.endsWith(WORKDAY_HOST_SUFFIX)) return false
  // A hostname and nothing else: no port, no credentials, no path, no
  // `evil.com#.myworkdayjobs.com` games.
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(lower)
}

function listUrl(descriptor: AtsBoardDescriptor): string | null {
  if (!isWorkdayHost(descriptor.host) || !descriptor.site) return null
  // The site id is case-sensitive and the tenant is part of the path, so both
  // are encoded rather than interpolated raw.
  return `https://${descriptor.host.toLowerCase()}/wday/cxs/${encodeURIComponent(descriptor.token)}/${encodeURIComponent(descriptor.site)}/jobs`
}

/**
 * `externalPath` is site-relative (`/job/US-CA-Santa-Clara/Engineer_JR123`),
 * and the browsable posting lives at `https://{host}/{site}{externalPath}` —
 * which `detectSource` classifies as Workday, so `get_job_details` routes it
 * to the Workday scraper.
 */
function postingUrl(descriptor: AtsBoardDescriptor, externalPath: string): string | null {
  if (!isWorkdayHost(descriptor.host) || !descriptor.site) return null
  const path = externalPath.startsWith('/') ? externalPath : `/${externalPath}`
  try {
    return new URL(`/${descriptor.site}${path}`, `https://${descriptor.host}`).toString()
  } catch {
    return null
  }
}

function toPosting(raw: unknown, descriptor: AtsBoardDescriptor, company: string): AtsPosting | null {
  const row = asRecord(raw)
  if (!row) return null

  const title = asString(row.title)
  const externalPath = asString(row.externalPath)
  if (!title || !externalPath) return null

  const url = postingUrl(descriptor, externalPath)
  if (!url) return null

  // `bulletFields` normally carries the requisition id; the path is unique
  // per posting either way, so it is the fallback identity.
  const id = asString(asArray(row.bulletFields)[0]) ?? externalPath

  return {
    id,
    title,
    company,
    // `locationsText` is a rendered label, not a place — it reads "2
    // Locations" on multi-site postings. Carried as-is rather than invented.
    location: asString(row.locationsText),
    url,
    // Workday publishes "Posted 30+ Days Ago", which is a phrase, not a date.
    // Turning that into a timestamp would mean making one up, so the phrase
    // goes in the snippet and `postedAt` stays empty.
    postedAt: undefined,
    snippet: toSnippet(asString(row.postedOn))
  }
}

export const workdayAdapter: AtsProviderAdapter = {
  provider: 'workday',
  label: 'Workday',
  serverSideQuery: true,
  probeable: false,

  async fetchBoard(descriptor, options: FetchBoardOptions): Promise<AtsBoardFetchOutcome> {
    const url = listUrl(descriptor)
    if (!url) {
      return { status: 'error', message: 'Workday board is missing its host or career-site id' }
    }

    // `options.limit` is how many postings to *gather*, not how many the
    // caller will show — the location filter runs downstream, so the caller
    // asks for headroom (see `searchAtsBoards`). Stopping at exactly the
    // number of rows a search wants to display would let a location filter
    // empty the result while matching postings sat on the next page.
    const wanted = Math.max(1, Math.min(options.limit, PAGE_SIZE * MAX_PAGES))
    const postings: AtsPosting[] = []
    let skipped = 0
    // Workday is the one provider that answers with a page plus a count of
    // what it paged through, so it is the one provider whose board size is
    // not "how many rows came back".
    let total: number | undefined

    for (let page = 0; page < MAX_PAGES && postings.length < wanted; page++) {
      const outcome = await fetchAtsJson(url, {
        method: 'POST',
        body: { limit: PAGE_SIZE, offset: page * PAGE_SIZE, searchText: options.query },
        notFoundStatuses: NOT_FOUND_STATUSES,
        timeoutMs: options.timeoutMs
      })
      // A failure on a later page still leaves the earlier pages usable, and
      // reporting an error would throw away rows we already have.
      if (outcome.status !== 'ok') {
        return page === 0 ? outcome : { status: 'ok', postings, skipped, total }
      }

      const body = asRecord(outcome.data)
      const rows = body ? asArray(body.jobPostings) : []
      if (!body || !Array.isArray(body.jobPostings)) {
        return page === 0
          ? { status: 'error', message: 'Workday response had no jobPostings array' }
          : { status: 'ok', postings, skipped, total }
      }

      // Read from the first page only: it is the count for this query, and a
      // later page repeating it adds nothing. Not trusted blindly — it comes
      // from someone else's API, so anything that isn't a sane count is left
      // undefined and the rows we hold stand as the answer.
      if (page === 0) {
        const reported = asFiniteNumber(body.total)
        if (reported !== undefined && reported >= 0) total = Math.floor(reported)
      }

      for (const raw of rows) {
        const posting = toPosting(raw, descriptor, options.companyName)
        if (posting) postings.push(posting)
        else skipped++
      }

      // Short page means the result set is exhausted.
      if (rows.length < PAGE_SIZE) break
    }

    return { status: 'ok', postings: postings.slice(0, wanted), skipped, total }
  },

  parseBoardUrl(url: URL): AtsBoardDescriptor | null {
    const host = url.hostname.toLowerCase()
    if (!host.endsWith('.myworkdayjobs.com')) return null

    const segments = url.pathname.split('/').filter(Boolean)
    // API form: /wday/cxs/{tenant}/{site}/jobs…
    if (segments[0] === 'wday' && segments[1] === 'cxs' && segments[2] && segments[3]) {
      return { provider: 'workday', token: segments[2], host, site: segments[3] }
    }

    // Browsable form: /{site}/… or /{locale}/{site}/… (e.g. /en-US/Careers/job/…).
    const withoutLocale = /^[a-z]{2}(-[A-Za-z]{2})?$/.test(segments[0] ?? '') ? segments.slice(1) : segments
    const site = withoutLocale[0]
    // The tenant is the first host label for every board of this shape; a
    // bare `wdN.myworkdayjobs.com` host carries no tenant, so it can only be
    // added through the API-form URL above.
    const tenant = host.split('.')[0]
    if (!site || !tenant || /^wd\d+$/.test(tenant)) return null

    return { provider: 'workday', token: tenant, host, site }
  }
}

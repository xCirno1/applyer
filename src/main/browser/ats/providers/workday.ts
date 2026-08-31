import { fetchAtsJson } from '../http'
import { asArray, asRecord, asString, toSnippet } from './shared'
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

function listUrl(descriptor: AtsBoardDescriptor): string | null {
  if (!descriptor.host || !descriptor.site) return null
  // The site id is case-sensitive and the tenant is part of the path, so both
  // are encoded rather than interpolated raw.
  return `https://${descriptor.host}/wday/cxs/${encodeURIComponent(descriptor.token)}/${encodeURIComponent(descriptor.site)}/jobs`
}

/**
 * `externalPath` is site-relative (`/job/US-CA-Santa-Clara/Engineer_JR123`),
 * and the browsable posting lives at `https://{host}/{site}{externalPath}` —
 * which `detectSource` classifies as Workday, so `get_job_details` routes it
 * to the Workday scraper.
 */
function postingUrl(descriptor: AtsBoardDescriptor, externalPath: string): string | null {
  if (!descriptor.host || !descriptor.site) return null
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

    const wanted = Math.max(1, Math.min(options.limit, PAGE_SIZE * MAX_PAGES))
    const postings: AtsPosting[] = []
    let skipped = 0

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
        return page === 0 ? outcome : { status: 'ok', postings, skipped }
      }

      const body = asRecord(outcome.data)
      const rows = body ? asArray(body.jobPostings) : []
      if (!body || !Array.isArray(body.jobPostings)) {
        return page === 0
          ? { status: 'error', message: 'Workday response had no jobPostings array' }
          : { status: 'ok', postings, skipped }
      }

      for (const raw of rows) {
        const posting = toPosting(raw, descriptor, options.companyName)
        if (posting) postings.push(posting)
        else skipped++
      }

      // Short page means the result set is exhausted.
      if (rows.length < PAGE_SIZE) break
    }

    return { status: 'ok', postings: postings.slice(0, wanted), skipped }
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

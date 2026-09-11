import { fetchAtsJson } from '../http'
import { asArray, asFiniteNumber, asRecord, asString, formatSalaryRange, safeHttpUrl, toIsoTimestamp } from './shared'
import { detectSource } from '../../sourceRouter'
import type { AtsBoardDescriptor } from '@shared/types/companyBoard'
import type { AtsBoardFetchOutcome, AtsPosting, AtsProviderAdapter } from '../types'

const HOSTS = ['boards.greenhouse.io', 'job-boards.greenhouse.io', 'boards-api.greenhouse.io']

/**
 * Deliberately *without* `content=true`.
 *
 * `content=true` is worth ~9 MB against ~40 KB on a large board, and search
 * only ever needs the title/location/department to filter on — the agent
 * reads the description through `get_job_details`, which fetches the single
 * posting. The cost of leaving it off is that Greenhouse also drops
 * `departments` and `offices` from the response (they ride along with the
 * content flag rather than being separate), so postings from this provider
 * carry no department; rebuilding it would mean a second request per board to
 * `/departments`, which isn't worth it for a field we only match keywords on.
 *
 * `pay_transparency=true` is free and is the only way pay appears at all —
 * the default response has no pay field whatsoever, which reads as "this
 * board doesn't publish pay" when in fact ~half of the postings do.
 */
function boardUrl(token: string): string {
  return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?pay_transparency=true`
}

/** `pay_input_ranges` amounts are integer cents, so 22280000 is 222,800. */
function payRange(job: Record<string, unknown>): string | undefined {
  const first = asRecord(asArray(job.pay_input_ranges)[0])
  if (!first) return undefined
  const min = asFiniteNumber(first.min_cents)
  const max = asFiniteNumber(first.max_cents)
  return formatSalaryRange(
    min === undefined ? undefined : min / 100,
    max === undefined ? undefined : max / 100,
    asString(first.currency_type),
    asString(first.title)
  )
}

function toPosting(raw: unknown, descriptor: AtsBoardDescriptor, fallbackCompany: string): AtsPosting | null {
  const job = asRecord(raw)
  if (!job) return null

  const id = asString(job.id) ?? asString(job.internal_job_id)
  const title = asString(job.title)
  if (!id || !title) return null

  // A board can be served from a company's own domain, which `detectSource`
  // (rightly) doesn't recognise as Greenhouse — using the canonical URL in
  // that case keeps `get_job_details` on the public API rather than sending
  // it to the generic browser scraper.
  const absolute = safeHttpUrl(job.absolute_url)
  const url =
    absolute && detectSource(absolute) === 'greenhouse'
      ? absolute
      : `https://job-boards.greenhouse.io/${encodeURIComponent(descriptor.token)}/jobs/${encodeURIComponent(id)}`

  return {
    id,
    title,
    company: asString(job.company_name) ?? fallbackCompany,
    location: asString(asRecord(job.location)?.name),
    url,
    postedAt: toIsoTimestamp(job.first_published) ?? toIsoTimestamp(job.updated_at),
    salaryRange: payRange(job),
    snippet: ''
  }
}

export const greenhouseAdapter: AtsProviderAdapter = {
  provider: 'greenhouse',
  label: 'Greenhouse',
  serverSideQuery: false,
  probeable: true,

  async fetchBoard(descriptor, options): Promise<AtsBoardFetchOutcome> {
    const outcome = await fetchAtsJson(boardUrl(descriptor.token), { timeoutMs: options.timeoutMs })
    if (outcome.status !== 'ok') return outcome

    const body = asRecord(outcome.data)
    if (!body || !Array.isArray(body.jobs)) {
      return { status: 'error', message: 'Greenhouse response had no jobs array' }
    }

    const postings: AtsPosting[] = []
    let skipped = 0
    for (const raw of body.jobs) {
      const posting = toPosting(raw, descriptor, options.companyName)
      if (posting) postings.push(posting)
      else skipped++
    }
    return { status: 'ok', postings, skipped }
  },

  parseBoardUrl(url: URL): AtsBoardDescriptor | null {
    if (!HOSTS.includes(url.hostname.toLowerCase())) return null
    const segments = url.pathname.split('/').filter(Boolean)
    // The API form is /v1/boards/{token}/jobs…, the public form /{token}/jobs/{id}.
    const token = segments[0] === 'v1' && segments[1] === 'boards' ? segments[2] : segments[0]
    if (!token) return null
    return { provider: 'greenhouse', token, host: null, site: null }
  }
}

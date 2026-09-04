import { fetchAtsJson } from '../http'
import { asFiniteNumber, asRecord, asString, formatSalaryRange, safeHttpUrl, toIsoTimestamp, toSnippet } from './shared'
import type { AtsBoardDescriptor } from '@shared/types/companyBoard'
import type { AtsBoardFetchOutcome, AtsPosting, AtsProviderAdapter } from '../types'

/**
 * Lever runs two independent regions, and a customer's board exists in
 * exactly one of them: an EU customer's postings are on `api.eu.lever.co` and
 * answer 404 on the US host. The region is therefore part of addressing the
 * board, not a preference — so it is carried in the descriptor's `host` (null
 * meaning the US default, which keeps every board already tracked keyed
 * exactly as it was).
 */
const REGIONS = [
  { public: 'jobs.lever.co', api: 'api.lever.co' },
  { public: 'jobs.eu.lever.co', api: 'api.eu.lever.co' }
] as const

/** The API hosts a stored descriptor may name. Anything else is not a Lever board. */
export const LEVER_API_HOSTS: string[] = REGIONS.map((region) => region.api)

const DEFAULT_REGION = REGIONS[0]

export function isLeverApiHost(host: string | null): boolean {
  return host !== null && LEVER_API_HOSTS.includes(host.toLowerCase())
}

/** The region a descriptor belongs to, defaulting to the US for the boards stored before regions existed. */
function regionOf(host: string | null): (typeof REGIONS)[number] {
  const lower = host?.toLowerCase()
  return REGIONS.find((region) => region.api === lower) ?? DEFAULT_REGION
}

function boardUrl(descriptor: AtsBoardDescriptor): string {
  return `https://${regionOf(descriptor.host).api}/v0/postings/${encodeURIComponent(descriptor.token)}?mode=json`
}

/**
 * `salaryRange` is `{min, max, currency, interval}` and is rare in the wild —
 * well under 1% of postings on a real board. Two things about it bite:
 * `{min: 0, max: 0}` means the company enabled the field and left it blank
 * (handled in `formatSalaryRange`), and `interval` is typed by the employer
 * and is sometimes plainly wrong, so it is shown and never used to rescale.
 */
function salary(posting: Record<string, unknown>): string | undefined {
  const range = asRecord(posting.salaryRange)
  if (!range) return undefined
  return formatSalaryRange(
    asFiniteNumber(range.min),
    asFiniteNumber(range.max),
    asString(range.currency),
    asString(range.interval)
  )
}

function toPosting(raw: unknown, descriptor: AtsBoardDescriptor, fallbackCompany: string): AtsPosting | null {
  const posting = asRecord(raw)
  if (!posting) return null

  const id = asString(posting.id)
  // Lever calls the job title `text`.
  const title = asString(posting.text)
  if (!id || !title) return null

  const categories = asRecord(posting.categories)
  const workplaceType = asString(posting.workplaceType)?.toLowerCase()

  return {
    id,
    title,
    // Lever never sends the company name under any key — the payload assumes
    // you know whose board you asked for. Filled from the tracked board.
    company: fallbackCompany,
    location: asString(categories?.location),
    department: asString(categories?.department),
    team: asString(categories?.team),
    employmentType: asString(categories?.commitment),
    isRemote: workplaceType === undefined ? undefined : workplaceType === 'remote',
    // The payload's own link when it has one; otherwise rebuilt on the board's
    // own region, since an EU board's postings are not served from the US host.
    url:
      safeHttpUrl(posting.hostedUrl) ??
      `https://${regionOf(descriptor.host).public}/${encodeURIComponent(descriptor.token)}/${encodeURIComponent(id)}`,
    postedAt: toIsoTimestamp(posting.createdAt),
    salaryRange: salary(posting),
    snippet: toSnippet(asString(posting.descriptionPlain) ?? asString(posting.description), !posting.descriptionPlain)
  }
}

export const leverAdapter: AtsProviderAdapter = {
  provider: 'lever',
  label: 'Lever',
  serverSideQuery: false,
  probeable: true,

  async fetchBoard(descriptor, options): Promise<AtsBoardFetchOutcome> {
    const outcome = await fetchAtsJson(boardUrl(descriptor), { timeoutMs: options.timeoutMs })
    if (outcome.status !== 'ok') return outcome

    // Lever answers with a bare array, not an object wrapping one.
    if (!Array.isArray(outcome.data)) {
      return { status: 'error', message: 'Lever response was not an array of postings' }
    }

    const postings: AtsPosting[] = []
    let skipped = 0
    for (const raw of outcome.data) {
      const posting = toPosting(raw, descriptor, options.companyName)
      if (posting) postings.push(posting)
      else skipped++
    }
    return { status: 'ok', postings, skipped }
  },

  parseBoardUrl(url: URL): AtsBoardDescriptor | null {
    const hostname = url.hostname.toLowerCase()
    const region = REGIONS.find((candidate) => candidate.public === hostname || candidate.api === hostname)
    if (!region) return null

    const segments = url.pathname.split('/').filter(Boolean)
    // Public: /{token}[/{postingId}]. API: /v0/postings/{token}[/{postingId}].
    const token = segments[0] === 'v0' && segments[1] === 'postings' ? segments[2] : segments[0]
    if (!token) return null

    // The US region stays `host: null` so a board tracked before regions
    // existed keeps its identity (`boardKeyOf` folds in a non-null host), and
    // the same board pasted twice is one row either way.
    return { provider: 'lever', token, host: region === DEFAULT_REGION ? null : region.api, site: null }
  }
}

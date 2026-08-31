import { fetchAtsJson } from '../http'
import { asFiniteNumber, asRecord, asString, formatSalaryRange, safeHttpUrl, toIsoTimestamp, toSnippet } from './shared'
import type { AtsBoardDescriptor } from '@shared/types/companyBoard'
import type { AtsBoardFetchOutcome, AtsPosting, AtsProviderAdapter } from '../types'

const HOSTS = ['jobs.lever.co', 'api.lever.co']

function boardUrl(token: string): string {
  return `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`
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
    url: safeHttpUrl(posting.hostedUrl) ?? `https://jobs.lever.co/${encodeURIComponent(descriptor.token)}/${encodeURIComponent(id)}`,
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
    const outcome = await fetchAtsJson(boardUrl(descriptor.token), { timeoutMs: options.timeoutMs })
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
    if (!HOSTS.includes(url.hostname.toLowerCase())) return null
    const segments = url.pathname.split('/').filter(Boolean)
    // Public: /{token}[/{postingId}]. API: /v0/postings/{token}[/{postingId}].
    const token = segments[0] === 'v0' && segments[1] === 'postings' ? segments[2] : segments[0]
    if (!token) return null
    return { provider: 'lever', token, host: null, site: null }
  }
}

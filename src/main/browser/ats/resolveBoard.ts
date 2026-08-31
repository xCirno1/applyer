import { ATS_PROBE_CONCURRENCY, ATS_PROBE_TIMEOUT_MS } from '@shared/constants'
import { isAtsProvider } from '@shared/types/companyBoard'
import { mapWithConcurrency } from './http'
import { adapterFor, parseAnyBoardUrl, probeableAdapters } from './providers'
import { slugCandidates } from './slugCandidates'
import type { AtsBoardDescriptor, AtsProvider, BoardProbeCandidate, ResolveBoardOutcome } from '@shared/types/companyBoard'
import type { AtsBoardFetchOutcome } from './types'

/**
 * Turning what a user or an agent typed into an addressable board.
 *
 * The trap this module exists for: **a 200 does not mean the board is
 * current**. An ATS migration leaves the old board up and answering, so a
 * company can be live on two systems at once — one with every role, one with
 * none — and "keep whichever provider answers first" reliably picks the dead
 * one for whichever provider happens to be probed first. So every candidate
 * is probed and the winner is the one with the most postings, never the first
 * responder.
 *
 * The mirror-image trap: **only a 404 proves a slug is wrong.** A real board
 * with nothing open answers 200 with an empty list, so an empty response is
 * kept as a weak candidate (flagged, never silently promoted) rather than
 * being read as "no such company".
 */

export interface ResolveBoardInput {
  /** A company name, a domain, or a board/posting URL from one of the four providers. */
  query: string
  /**
   * Skips probing entirely when both are given — the caller already knows the
   * board (a pasted URL, or an agent that looked the slug up itself).
   */
  provider?: AtsProvider
  token?: string
  /**
   * When known — e.g. the careers page links this ATS — the provider to
   * prefer among candidates that tie. Never enough on its own to beat a
   * provider that actually has postings.
   */
  preferProvider?: AtsProvider
  /** Display name to attach; falls back to the resolved token. */
  companyName?: string
}

interface ProbeResult {
  provider: AtsProvider
  token: string
  outcome: AtsBoardFetchOutcome
}

/** Probing only needs to know whether a board answers and how much it holds, so it asks for very little. */
const PROBE_LIMIT = 20

async function probe(descriptor: AtsBoardDescriptor, query: string): Promise<AtsBoardFetchOutcome> {
  const adapter = adapterFor(descriptor.provider)
  if (!adapter) return { status: 'error', message: `Unknown ATS provider: ${descriptor.provider}` }
  try {
    return await adapter.fetchBoard(descriptor, {
      query,
      limit: PROBE_LIMIT,
      companyName: descriptor.token,
      timeoutMs: ATS_PROBE_TIMEOUT_MS
    })
  } catch (err) {
    // An adapter is not supposed to throw, but a probe must never take the
    // whole resolution down with it if one does.
    return { status: 'error', message: String(err) }
  }
}

/**
 * Ranks the boards that answered.
 *
 * Order of precedence, highest first:
 *  1. postings on the board (the migration case above),
 *  2. the caller's preferred provider,
 *  3. how close the slug was to the input (candidates come best-guess-first),
 *  4. registry order, so the result never depends on which request finished first.
 */
function rank(results: ProbeResult[], candidateOrder: string[], preferProvider: AtsProvider | undefined): ProbeResult[] {
  const providerOrder = new Map(probeableAdapters().map((adapter, index) => [adapter.provider, index]))

  return [...results].sort((a, b) => {
    const aCount = a.outcome.status === 'ok' ? a.outcome.postings.length : -1
    const bCount = b.outcome.status === 'ok' ? b.outcome.postings.length : -1
    if (aCount !== bCount) return bCount - aCount

    if (preferProvider) {
      const aPreferred = a.provider === preferProvider ? 0 : 1
      const bPreferred = b.provider === preferProvider ? 0 : 1
      if (aPreferred !== bPreferred) return aPreferred - bPreferred
    }

    const aToken = candidateOrder.indexOf(a.token)
    const bToken = candidateOrder.indexOf(b.token)
    if (aToken !== bToken) return aToken - bToken

    return (providerOrder.get(a.provider) ?? 99) - (providerOrder.get(b.provider) ?? 99)
  })
}

function toCandidate(result: ProbeResult): BoardProbeCandidate {
  return {
    provider: result.provider,
    token: result.token,
    jobCount: result.outcome.status === 'ok' ? result.outcome.postings.length : 0
  }
}

/** Verifies a board the caller already identified, rather than guessing at one. */
async function resolveExplicit(
  descriptor: AtsBoardDescriptor,
  companyName: string | undefined
): Promise<ResolveBoardOutcome> {
  const outcome = await probe(descriptor, '')

  if (outcome.status === 'not_found') {
    return { status: 'not_found', triedTokens: [descriptor.token] }
  }
  if (outcome.status === 'error') {
    // The caller told us exactly which board this is, so a network failure is
    // no reason to refuse it — it is stored unverified and the next search
    // will find out whether it works.
    return {
      status: 'resolved',
      descriptor,
      companyName: companyName?.trim() || descriptor.token,
      jobCount: 0,
      verified: false,
      ambiguous: false,
      candidates: []
    }
  }

  return {
    status: 'resolved',
    descriptor,
    companyName: companyName?.trim() || descriptor.token,
    jobCount: outcome.postings.length,
    verified: true,
    ambiguous: false,
    candidates: [{ provider: descriptor.provider, token: descriptor.token, jobCount: outcome.postings.length }]
  }
}

export async function resolveCompanyBoard(input: ResolveBoardInput): Promise<ResolveBoardOutcome> {
  const query = input.query.trim()

  // 1. An explicit provider + token, or a Workday board (which can only ever
  //    be given explicitly — see providers/workday.ts).
  if (input.provider && input.token?.trim()) {
    if (!isAtsProvider(input.provider)) {
      return { status: 'error', message: `Unknown ATS provider: ${String(input.provider)}` }
    }
    if (input.provider === 'workday') {
      return {
        status: 'error',
        message:
          'A Workday board needs a host, tenant and career-site id, which cannot be derived from a token — paste the board URL instead.'
      }
    }
    // With the board given explicitly, the query is free to be what it
    // usually is in that call — the company's actual name — so it beats
    // falling back to the slug for the display name.
    return resolveExplicit(
      { provider: input.provider, token: input.token.trim(), host: null, site: null },
      input.companyName ?? (query.includes('://') ? undefined : query)
    )
  }

  // 2. A pasted board or posting URL — unambiguous, so no probing.
  const fromUrl = query ? parseAnyBoardUrl(query) : null
  if (fromUrl) return resolveExplicit(fromUrl, input.companyName)

  // 3. A bare name or domain: guess slugs, probe every provider that can be
  //    probed, and rank what answers.
  const tokens = slugCandidates(query)
  if (tokens.length === 0) {
    return {
      status: 'error',
      message: 'Could not derive a board slug from that — give a company name, a domain, or a board URL.'
    }
  }

  const adapters = probeableAdapters()
  const pairs = tokens.flatMap((token) => adapters.map((adapter) => ({ provider: adapter.provider, token })))

  const results = await mapWithConcurrency(pairs, ATS_PROBE_CONCURRENCY, async (pair) => ({
    provider: pair.provider,
    token: pair.token,
    outcome: await probe({ provider: pair.provider, token: pair.token, host: null, site: null }, query)
  }))

  const answered = results.filter((result) => result.outcome.status === 'ok')
  if (answered.length === 0) {
    // Every probe failing for a network reason is not the same answer as
    // every probe 404ing, and reporting "no such company" when the machine is
    // offline would send the user hunting for a slug that is fine.
    const allErrored = results.every((result) => result.outcome.status === 'error')
    if (allErrored) {
      const first = results.find((result) => result.outcome.status === 'error')
      const message = first?.outcome.status === 'error' ? first.outcome.message : 'unknown error'
      return { status: 'error', message: `Could not reach any board API (${message}).` }
    }
    return { status: 'not_found', triedTokens: tokens }
  }

  const ranked = rank(answered, tokens, input.preferProvider)
  const best = ranked[0]!
  const bestCount = best.outcome.status === 'ok' ? best.outcome.postings.length : 0

  return {
    status: 'resolved',
    descriptor: { provider: best.provider, token: best.token, host: null, site: null },
    companyName: input.companyName?.trim() || best.token,
    jobCount: bestCount,
    verified: true,
    // Two providers holding live postings for one slug is the migration case,
    // and the caller is told rather than having one of them silently dropped.
    ambiguous: ranked.filter((r) => (r.outcome.status === 'ok' ? r.outcome.postings.length : 0) > 0).length > 1,
    candidates: ranked.map(toCandidate)
  }
}

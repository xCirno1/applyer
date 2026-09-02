import { greenhouseAdapter } from './greenhouse'
import { leverAdapter } from './lever'
import { ashbyAdapter } from './ashby'
import { workdayAdapter } from './workday'
import type { AtsBoardDescriptor, AtsProvider } from '@shared/types/companyBoard'
import type { AtsProviderAdapter } from '../types'

/**
 * Registry of the four board APIs.
 *
 * Order is load-bearing in two places, so it is fixed here rather than
 * derived: probing walks it, and it is the last tie-break when two providers
 * answer with the same number of postings.
 */
export const ATS_ADAPTERS: AtsProviderAdapter[] = [
  greenhouseAdapter,
  leverAdapter,
  ashbyAdapter,
  workdayAdapter
]

const BY_PROVIDER = new Map<AtsProvider, AtsProviderAdapter>(ATS_ADAPTERS.map((a) => [a.provider, a]))

export function adapterFor(provider: AtsProvider): AtsProviderAdapter | undefined {
  return BY_PROVIDER.get(provider)
}

/** The providers a bare company name can be resolved against — see `workday.ts` for why it isn't one. */
export function probeableAdapters(): AtsProviderAdapter[] {
  return ATS_ADAPTERS.filter((adapter) => adapter.probeable)
}

/**
 * Stable identity for a board, used as the database's uniqueness key and as
 * the cache key. Slugs and hostnames are lowercased, so the same board added
 * as `Acme` and `acme` is one row; Workday folds in host and site too, since
 * a tenant alone doesn't address a board.
 *
 * The career-site id is the one part kept verbatim: Workday treats it as
 * case-sensitive, so `Careers` and `careers` can be two different sites on
 * one tenant. Folding their case together would make adding the second look
 * like a duplicate of the first and leave searches pointed at the wrong one.
 */
export function boardKeyOf(descriptor: AtsBoardDescriptor): string {
  const base = `${descriptor.provider}:${descriptor.token.toLowerCase()}`
  if (descriptor.provider !== 'workday') return base
  return `${base}:${(descriptor.host ?? '').toLowerCase()}:${descriptor.site ?? ''}`
}

/**
 * Recognises a pasted board or posting URL from any of the four providers.
 * Returns null for anything else, including a company's own careers page —
 * we don't scrape a site to sniff the ATS widget behind it, we probe the
 * board APIs directly instead (see `resolveBoard.ts`).
 */
export function parseAnyBoardUrl(input: string): AtsBoardDescriptor | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null

  for (const adapter of ATS_ADAPTERS) {
    const descriptor = adapter.parseBoardUrl(url)
    if (descriptor) return descriptor
  }
  return null
}

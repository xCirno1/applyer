import { greenhouseAdapter } from './greenhouse'
import { isLeverApiHost, leverAdapter } from './lever'
import { ashbyAdapter } from './ashby'
import { isWorkdayHost, workdayAdapter } from './workday'
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
  if (descriptor.provider === 'workday') {
    return `${base}:${(descriptor.host ?? '').toLowerCase()}:${descriptor.site ?? ''}`
  }
  // Lever's two regions are separate boards that can share a slug, so the
  // region is part of the identity when there is one. A null host is the US
  // default and adds nothing to the key, which is what keeps every board
  // tracked before regions existed keyed exactly as it was.
  if (descriptor.host) return `${base}:${descriptor.host.toLowerCase()}`
  return base
}

/**
 * A board slug is one path segment on a fixed host, so anything with
 * whitespace, a separator or a scheme in it is a mis-mapped column or a
 * hand-edited file rather than a token to go and fetch.
 */
export function isPlausibleBoardToken(token: string): boolean {
  return token.length > 0 && token.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._~-]*$/.test(token)
}

/**
 * Whether a descriptor is one this app could have produced itself.
 *
 * Every board this app builds comes from `parseBoardUrl` or from probing, so
 * its fields are constrained by construction — but a descriptor can also
 * arrive in an export bundle, which is a file a person can write. The host
 * field is the one that matters: it becomes the authority of an outbound
 * request, so an unchecked one turns "import this watchlist" into "POST to a
 * host of my choosing on the next search". The rest is checked in the same
 * pass because a row that cannot address a board is only ever going to sit in
 * the watchlist failing every search.
 */
export function isValidBoardDescriptor(descriptor: AtsBoardDescriptor): boolean {
  if (!isPlausibleBoardToken(descriptor.token)) return false

  switch (descriptor.provider) {
    case 'workday':
      // A career site is a single path segment, and it is the one field kept
      // case-sensitively, so it is checked rather than normalised.
      return isWorkdayHost(descriptor.host) && descriptor.site !== null && /^[A-Za-z0-9._~-]{1,128}$/.test(descriptor.site)
    case 'lever':
      // Null (the US default) or one of the two real API hosts, never an
      // arbitrary one.
      return descriptor.site === null && (descriptor.host === null || isLeverApiHost(descriptor.host))
    default:
      // Greenhouse and Ashby are a slug on a fixed host: neither field means
      // anything for them, and a value in one is a file asserting something
      // this app would never write.
      return descriptor.host === null && descriptor.site === null
  }
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

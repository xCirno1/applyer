import { MAX_SLUG_CANDIDATES } from '@shared/constants'
import { LEGAL_SUFFIXES, stripLegalSuffix } from './companyNames'

/**
 * Turning "Acme Labs" or "acme.com" into the slugs a board might live under.
 *
 * There is no directory to look this up in, and we deliberately don't fetch
 * the company's own site to sniff which ATS widget its careers page embeds —
 * probing the board APIs directly is cheaper, has no HTML parsing to rot, and
 * answers the same question. The cost is that these are guesses, which is why
 * `resolveBoard` ranks what comes back instead of trusting the first hit.
 */

/**
 * Subdomains that name a *function* rather than the company, so the label
 * after them is the one worth guessing: `careers.acme.com` is Acme's board,
 * not a company called Careers.
 */
const FUNCTIONAL_SUBDOMAINS = new Set([
  'www',
  'careers',
  'career',
  'jobs',
  'job',
  'boards',
  'board',
  'apply',
  'hire',
  'hiring',
  'join',
  'work',
  'talent',
  'recruiting',
  'people'
])

/** Long enough to be a real slug, short enough that a board would accept it. */
const MIN_SLUG_LENGTH = 2
const MAX_SLUG_LENGTH = 60

function cleanSlug(value: string): string | null {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '')
    .replace(/^-+|-+$/g, '')
  if (slug.length < MIN_SLUG_LENGTH || slug.length > MAX_SLUG_LENGTH) return null
  return slug
}

function words(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // "&" is written "and" in slugs far more often than it is dropped.
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/**
 * Pulls the company label out of a hostname: `careers.acme.co.uk` → `acme`.
 * Walks past functional subdomains rather than blindly taking the first
 * label, which would guess "careers" for every company that hosts its board
 * on one.
 */
export function hostToSlugCandidates(hostname: string): string[] {
  const labels = hostname
    .toLowerCase()
    .replace(/\.$/, '')
    .split('.')
    .filter(Boolean)
  if (labels.length === 0) return []

  const meaningful = labels.filter((label) => !FUNCTIONAL_SUBDOMAINS.has(label))
  // Everything after the company label is a public suffix (`com`, `co.uk`),
  // and a bare hostname with nothing else left falls back to the raw labels.
  const source = meaningful.length > 0 ? meaningful : labels

  const candidates = [source[0]!]
  // `acme.co.uk` leaves ["acme", "co", "uk"]; a two-word brand hosted as
  // `acmelabs.com` is already one label, so only the first is a real guess —
  // but `eu.acme.com` style prefixes we don't know about make the second
  // label worth trying too.
  if (source.length > 2 && source[1] && !LEGAL_SUFFIXES.has(source[1])) candidates.push(source[1])

  return candidates.map(cleanSlug).filter((slug): slug is string => slug !== null)
}

/**
 * Slug guesses for one company name, domain, or careers URL, best guess
 * first. Returns an empty array when nothing usable can be derived, which the
 * caller must treat as "cannot resolve" rather than probing an empty slug.
 */
export function slugCandidates(input: string): string[] {
  const trimmed = input.trim()
  if (!trimmed) return []

  const candidates: string[] = []
  const push = (value: string | null): void => {
    if (value && !candidates.includes(value)) candidates.push(value)
  }

  // A URL or a bare domain is a much stronger signal than a display name, and
  // it is also a different kind of string: running the name path over
  // "https://acme.com" would guess "httpsacmecom". So a parsed host wins
  // outright rather than being mixed with name-derived guesses.
  const asUrl = trimmed.includes('://')
    ? trimmed
    : /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(trimmed.split('/')[0] ?? '')
      ? `https://${trimmed}`
      : null
  if (asUrl) {
    try {
      const url = new URL(asUrl)
      for (const candidate of hostToSlugCandidates(url.hostname)) push(candidate)
      // A careers URL of the form acme.com/careers/greenhouse-slug tells us
      // nothing reliable, so path segments are deliberately not mined.
      if (candidates.length > 0) return candidates.slice(0, MAX_SLUG_CANDIDATES)
    } catch {
      // Not a URL after all — fall through to the name handling below.
    }
  }

  const parts = stripLegalSuffix(words(trimmed))
  if (parts.length > 0) {
    push(cleanSlug(parts.join('')))
    if (parts.length > 1) {
      push(cleanSlug(parts.join('-')))
      push(cleanSlug(parts[0]!))
    }
  }

  return candidates.slice(0, MAX_SLUG_CANDIDATES)
}

import { stripLegalSuffix } from './companyNames'
import type { AtsPosting } from './types'

/**
 * Local keyword filtering.
 *
 * None of the four providers has a cross-company search endpoint, and three of
 * them only serve a whole board, so the filtering an aggregator does
 * server-side has to happen here instead. It runs over the fields a board
 * actually fills in — title, department, team, location, employment type —
 * and not over the description body: matching "engineer" against a full
 * posting body hits every company's boilerplate and turns a keyword search
 * into "everything this company has open".
 */

/**
 * Lowercase, strip accents, and reduce anything that isn't a letter or digit
 * to a space.
 *
 * "Letter" is deliberately every script's letters, not `a-z`: an ASCII-only
 * class erases a query written in Japanese, Cyrillic or Greek down to the
 * empty string, which `matchesQuery` then reads as "no filter given" and
 * answers with the company's entire board. It would also fold two different
 * non-Latin company names onto the same `crossSourceKey`, deduping unrelated
 * postings against each other.
 */
export function normalizeText(value: string): string {
  return (
    value
      .normalize('NFD')
      // Latin diacritics only. Decomposition splits marks in other scripts
      // too \u2014 Japanese dakuten, for one \u2014 so whatever wasn't stripped is put
      // back by recomposing, and any mark that has no composed form is kept
      // as part of its word rather than becoming a space (Devanagari matras,
      // Arabic and Hebrew points).
      .replace(/[\u0300-\u036f]/g, '')
      .normalize('NFC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
      .trim()
  )
}

export function queryTerms(query: string): string[] {
  const normalized = normalizeText(query)
  if (!normalized) return []
  return Array.from(new Set(normalized.split(' ').filter(Boolean)))
}

function titleHaystack(posting: AtsPosting): string {
  return normalizeText(posting.title)
}

function fullHaystack(posting: AtsPosting): string {
  return normalizeText(
    [
      posting.title,
      posting.company,
      posting.department ?? '',
      posting.team ?? '',
      posting.location ?? '',
      posting.employmentType ?? '',
      posting.isRemote ? 'remote' : ''
    ].join(' ')
  )
}

/** Below this length a term must match a whole word — "ai" must not match "aid". */
const MIN_PREFIX_TERM_LENGTH = 4

/**
 * Word-boundary containment: `" engineer "` inside a space-padded haystack,
 * with a prefix match for longer terms so "engineer" still finds
 * "engineering". Plain `includes` would match "art" inside "start", and an
 * unconditional prefix match would make short terms match almost anything.
 */
function containsTerm(haystack: string, term: string): boolean {
  const padded = ` ${haystack} `
  if (padded.includes(` ${term} `)) return true
  return term.length >= MIN_PREFIX_TERM_LENGTH && padded.includes(` ${term}`)
}

/** Every term must appear somewhere — the same AND semantics a job site's search box has. */
export function matchesQuery(posting: AtsPosting, terms: readonly string[]): boolean {
  if (terms.length === 0) return true
  const haystack = fullHaystack(posting)
  return terms.every((term) => containsTerm(haystack, term))
}

/**
 * Location filtering, with the one special case that matters: a request for
 * "remote" is satisfied by a posting the board flags remote even when its
 * location text names a city (most remote postings still carry an office).
 *
 * The flag answers the word "remote" and nothing else, though. "Remote
 * Australia" is a request for two things, and letting the flag alone satisfy
 * it would return remote roles on every other continent — so any place named
 * alongside "remote" still has to appear in the posting's own location text.
 *
 * A posting with no location text at all cannot satisfy a location filter —
 * treating "unknown" as "matches" would quietly widen every filtered search.
 */
export function matchesLocation(posting: AtsPosting, location: string | undefined): boolean {
  if (!location?.trim()) return true

  const terms = queryTerms(location)
  if (terms.length === 0) return true

  const haystack = normalizeText(posting.location ?? '')

  if (posting.isRemote && terms.includes('remote')) {
    const places = terms.filter((term) => term !== 'remote')
    if (places.length === 0) return true
    if (!haystack) return false
    return places.every((term) => containsTerm(haystack, term))
  }

  if (!haystack) return false
  return terms.every((term) => containsTerm(haystack, term))
}

const RECENCY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Relevance, then freshness. A term in the title is worth far more than the
 * same term in a department name, and a posting from this week outranks an
 * identical one from six months ago — but recency can never outweigh a title
 * hit, which is why its contribution is capped well below a single one.
 */
export function scorePosting(posting: AtsPosting, terms: readonly string[], now = Date.now()): number {
  const title = titleHaystack(posting)
  const full = fullHaystack(posting)

  let score = 0
  for (const term of terms) {
    if (containsTerm(title, term)) score += 10
    else if (containsTerm(full, term)) score += 3
  }

  if (posting.postedAt) {
    const age = now - Date.parse(posting.postedAt)
    if (Number.isFinite(age) && age >= 0) {
      score += 2 * Math.max(0, 1 - age / RECENCY_WINDOW_MS)
    }
  }
  return score
}

/**
 * Filters to postings that match, then orders them best-first. Ties fall back
 * to newest, then to the posting URL, so the same board always produces the
 * same order — an unstable order would make the indexed-jobs history look
 * like it churned between two identical searches.
 */
export function rankPostings(
  postings: readonly AtsPosting[],
  terms: readonly string[],
  location: string | undefined,
  now = Date.now()
): AtsPosting[] {
  return postings
    .filter((posting) => matchesQuery(posting, terms) && matchesLocation(posting, location))
    .map((posting) => ({ posting, score: scorePosting(posting, terms, now) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const aTime = a.posting.postedAt ? Date.parse(a.posting.postedAt) : 0
      const bTime = b.posting.postedAt ? Date.parse(b.posting.postedAt) : 0
      if ((bTime || 0) !== (aTime || 0)) return (bTime || 0) - (aTime || 0)
      return a.posting.url.localeCompare(b.posting.url)
    })
    .map((entry) => entry.posting)
}

/**
 * Cross-source identity, used to drop an aggregator's copy of a posting we
 * already have straight from the company's board.
 *
 * The same posting on LinkedIn and on Greenhouse has two different URLs and
 * no shared id, so URL-keyed dedupe can't see them as one; company + title +
 * location is the only thing both rows carry. Location is part of the key on
 * purpose: a board that publishes one posting per city is publishing genuinely
 * different rows, and collapsing those would hide locations the user wants.
 */
export function crossSourceKey(company: string, title: string, location: string | undefined): string {
  // The company name is the field the two sources are most likely to write
  // differently — "Acme" on its own board, "Acme Inc." on an aggregator — so
  // the legal form comes off before comparing.
  const employer = stripLegalSuffix(normalizeText(company).split(' ').filter(Boolean)).join(' ')
  return [employer, normalizeText(title), normalizeText(location ?? '')].join('|')
}

/**
 * Merges per-board ranked lists round-robin rather than by global score.
 *
 * The point of this feature is finding the companies that never syndicate to
 * an aggregator, and those companies have five open roles against a large
 * board's five hundred. A global sort hands the whole result page to the
 * biggest board; taking one posting from each board in turn, best board
 * first, keeps the small ones visible while still leading with the strongest
 * match.
 */
export function interleaveByBoard<T>(rankedPerBoard: readonly T[][], limit: number): T[] {
  const merged: T[] = []
  const longest = rankedPerBoard.reduce((max, list) => Math.max(max, list.length), 0)

  for (let round = 0; round < longest && merged.length < limit; round++) {
    for (const list of rankedPerBoard) {
      if (merged.length >= limit) break
      const posting = list[round]
      if (posting) merged.push(posting)
    }
  }
  return merged
}

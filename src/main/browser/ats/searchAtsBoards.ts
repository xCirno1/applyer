import { ATS_FETCH_CONCURRENCY, MAX_ATS_BOARDS_PER_SEARCH } from '@shared/constants'
import { appLogger } from '../../logger'
import { listSearchableCompanyBoards } from '../../db/repositories/companyBoardsRepository'
import { broadcastCompanyBoardsChanged } from '../../ipc/jobsBroadcast'
import { recordBoardFetchOutcome } from './boardFetchRecord'
import { selectBoardsForSweep } from './boardSweep'
import { boardCacheKey, readBoardCache, writeBoardCache } from './boardCache'
import { mapWithConcurrency } from './http'
import { adapterFor } from './providers'
import { crossSourceKey, interleaveByBoard, queryTerms, rankPostings } from './matching'
import type { AtsProvider, CompanyBoardRecord } from '@shared/types/companyBoard'
import type { JobSearchResultItem } from '../types'
import type { AtsBoardFetchOutcome, AtsPosting } from './types'

/**
 * The third search source, alongside Indeed and LinkedIn.
 *
 * The aggregators run one keyword query against every company at once; this
 * one can't, because no ATS provider offers a cross-company search endpoint.
 * Instead it fetches the boards of the companies being tracked (see
 * `companyBoardsRepository`) and filters them locally. That makes its
 * coverage exactly the watchlist — a monitoring tool, not a discovery one —
 * but it reaches the companies that run a board and never syndicate to an
 * aggregator, which are invisible to the other two sources.
 *
 * These are plain public JSON APIs: no browser, no login, no captcha surface,
 * so a search here is cheap and can't be blocked the way a scraped
 * aggregator can.
 */

export interface SearchAtsBoardsParams {
  query: string
  location?: string
  limit: number
  /** Restricts the search to boards on these providers; omitted means all of them. */
  providers?: AtsProvider[]
}

export interface SearchAtsBoardsResult {
  results: JobSearchResultItem[]
  warnings: string[]
  /** Boards actually fetched (or served from cache) — 0 means nothing is being tracked. */
  searchedBoards: number
  /**
   * Providers at least one tracked board was actually fetched for — reported
   * as `searchedSources`, so a provider with nothing tracked is honestly
   * absent from it rather than listed as searched.
   */
  searchedProviders: AtsProvider[]
}

/** A posting kept with the board it came from, so the merge below doesn't have to look it up again. */
interface BoardPosting {
  board: CompanyBoardRecord
  posting: AtsPosting
}

function toSearchResult(board: CompanyBoardRecord, posting: AtsPosting): JobSearchResultItem {
  return {
    title: posting.title,
    company: posting.company || board.companyName,
    location: posting.location,
    url: posting.url,
    source: board.provider,
    postedAt: posting.postedAt,
    snippet: posting.snippet,
    salaryRange: posting.salaryRange
  }
}

/**
 * Multiplier applied to the caller's limit when fetching.
 *
 * Only a provider that pages server-side (Workday) stops at what was asked
 * for, and everything that narrows the result — the location filter, the
 * cross-board dedupe — runs *after* the fetch. Asking for exactly `limit`
 * rows there can therefore filter down to nothing while matching postings sit
 * on the next page. Same reasoning, and the same factor, as the headroom the
 * interleave below uses.
 */
const FETCH_HEADROOM = 3

async function fetchBoard(board: CompanyBoardRecord, query: string, limit: number): Promise<AtsBoardFetchOutcome> {
  const adapter = adapterFor(board.provider)
  if (!adapter) return { status: 'error', message: `Unknown ATS provider: ${board.provider}` }

  const cacheKey = boardCacheKey(board, query, limit)
  const cached = readBoardCache(cacheKey)
  if (cached) return cached

  let outcome: AtsBoardFetchOutcome
  try {
    outcome = await adapter.fetchBoard(board, { query, limit, companyName: board.companyName })
  } catch (err) {
    // Adapters return outcomes rather than throwing, but one unexpected throw
    // must not take down a search across every other board.
    outcome = { status: 'error', message: String(err) }
  }

  writeBoardCache(cacheKey, outcome)
  return outcome
}

export async function searchAtsBoards(params: SearchAtsBoardsParams): Promise<SearchAtsBoardsResult> {
  const warnings: string[] = []

  let tracked: CompanyBoardRecord[]
  try {
    tracked = listSearchableCompanyBoards(params.providers)
  } catch (err) {
    appLogger.error(`Failed to read tracked company boards: ${String(err)}`)
    return {
      results: [],
      warnings: [`company boards: could not read the tracked-board list (${String(err)}).`],
      searchedBoards: 0,
      searchedProviders: []
    }
  }

  if (tracked.length === 0) {
    warnings.push(
      'company boards: no boards are being tracked yet, so there was nothing to search. Add one with add_company_board (a company name, domain, or board URL), or from Indexed Jobs > Company Boards in the app.'
    )
    return { results: [], warnings, searchedBoards: 0, searchedProviders: [] }
  }

  // Which boards the budget is spent on, rather than whichever happen to come
  // first — see `boardSweep.ts` for why size alone is not the whole rule.
  const sweep = selectBoardsForSweep(tracked, MAX_ATS_BOARDS_PER_SEARCH)
  const boards = sweep.boards
  if (sweep.skipped > 0) {
    warnings.push(
      `company boards: ${tracked.length} boards are tracked and ${boards.length} were searched (one request each) — the ${sweep.pickedBySize} carrying the most open roles, plus the ${sweep.pickedByRotation} nothing has checked in longest. Run another search to reach further down the list, or pause the boards you aren't watching.`
    )
  }

  const terms = queryTerms(params.query)
  const now = Date.now()

  const perBoard = await mapWithConcurrency(boards, ATS_FETCH_CONCURRENCY, async (board) => {
    const outcome = await fetchBoard(board, params.query, params.limit * FETCH_HEADROOM)
    // The query goes with the outcome: on a provider that filters
    // server-side, what came back counts the query's matches, not the board
    // (see `countsWholeBoard`).
    recordBoardFetchOutcome(board, outcome, params.query)
    return { board, outcome }
  })

  // Every board above just had its last-checked time, role count or error
  // rewritten, and a search is where most of those updates happen. The panel
  // showing them reads the list on mount and then stays mounted while another
  // screen is up, so without this signal it would keep displaying whatever it
  // read when the app started.
  try {
    broadcastCompanyBoardsChanged()
  } catch (err) {
    appLogger.warn(`Failed to broadcast company board changes: ${String(err)}`)
  }

  const rankedPerBoard: BoardPosting[][] = []
  const searchedProviders = new Set<AtsProvider>()

  for (const { board, outcome } of perBoard) {
    searchedProviders.add(board.provider)

    if (outcome.status === 'not_found') {
      warnings.push(
        `${board.companyName} (${board.provider}): board not found (404). The slug may have changed, or the company may have moved to another ATS.`
      )
      continue
    }
    if (outcome.status === 'error') {
      warnings.push(`${board.companyName} (${board.provider}): could not be fetched (${outcome.message}).`)
      continue
    }
    if (outcome.skipped > 0) {
      // Not a user-facing warning: a few unreadable rows on an otherwise fine
      // board is a payload change to investigate, not something a job seeker
      // can act on.
      appLogger.warn(`${board.boardKey}: skipped ${outcome.skipped} unreadable posting(s)`)
    }

    const ranked = rankPostings(outcome.postings, terms, params.location, now)
    if (ranked.length === 0) continue
    rankedPerBoard.push(ranked.map((posting) => ({ board, posting })))
  }

  // One job can arrive twice: a company tracked under two slugs, or — the
  // case that actually happens — a company mid-ATS-migration whose old board
  // is still live, where the same role has an entirely different URL on each
  // board. URLs can't see that, so company + title + location is checked too.
  //
  // Only *across* boards, though. Two postings on one board with the same
  // title and location are two requisitions the company chose to publish
  // separately, and the board's own ids already keep them apart.
  const seenUrls = new Set<string>()
  const seenPostings = new Map<string, string>()
  const results: JobSearchResultItem[] = []

  // Interleaved with headroom, because dedupe drops entries after the merge
  // and a limit-sized merge would come up short.
  for (const { board, posting } of interleaveByBoard(rankedPerBoard, params.limit * 3)) {
    if (seenUrls.has(posting.url)) continue

    const identity = crossSourceKey(posting.company || board.companyName, posting.title, posting.location)
    const seenOnBoard = seenPostings.get(identity)
    if (seenOnBoard !== undefined && seenOnBoard !== board.boardKey) continue

    seenUrls.add(posting.url)
    seenPostings.set(identity, board.boardKey)

    results.push(toSearchResult(board, posting))
    if (results.length >= params.limit) break
  }

  return {
    results,
    warnings,
    searchedBoards: boards.length,
    searchedProviders: [...searchedProviders]
  }
}

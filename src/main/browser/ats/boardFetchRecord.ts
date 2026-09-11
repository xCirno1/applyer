import { appLogger } from '../../logger'
import { recordCompanyBoardFetch } from '../../db/repositories/companyBoardsRepository'
import { adapterFor } from './providers'
import type { AtsProvider, CompanyBoardRecord } from '@shared/types/companyBoard'
import type { AtsBoardFetchOutcome } from './types'

/**
 * Writing back what a board fetch came to, shared by the two things that
 * fetch one: a `search_jobs` sweep (`searchAtsBoards`) and the watchlist's
 * own "fetch now" button (`refreshBoards`). Both must file the same outcome
 * the same way, or a board would read differently depending on which one
 * last touched it.
 */

/**
 * A 404 is the one provider answer that means the slug itself is wrong, so it
 * is stored as a sentence rather than a status code — this is what the
 * watchlist's "Last result" column shows, and "404" is not an explanation.
 */
export const BOARD_NOT_FOUND_MESSAGE =
  'Board not found (404). The slug may have changed or the board may have been retired.'

/**
 * The count a fetch outcome puts in the row: only a successful fetch has one.
 *
 * The provider's own total wins over the rows we hold when it offers one,
 * because a paging provider returns a page, not a board — reporting
 * `postings.length` there would file a Workday board of 300 roles as having
 * the 60 that fit in the fetch.
 */
export function fetchedJobCount(outcome: AtsBoardFetchOutcome): number {
  if (outcome.status !== 'ok') return 0
  const total = outcome.total
  if (total !== undefined && Number.isFinite(total) && total >= outcome.postings.length) return Math.floor(total)
  return outcome.postings.length
}

/**
 * Whether this fetch counted the board, or only the part of it that matched a
 * query.
 *
 * Three of the four providers serve a whole board and are filtered locally,
 * so what came back is the board's size whatever was being searched for.
 * Workday is the exception: the query goes to Workday, and both the rows and
 * the `total` beside them are the answer to *that query*. Storing that as the
 * board's open-role count would tell a person a tenant with 800 roles has the
 * four that matched "rust", and would then demote the largest board on the
 * watchlist in every later, unrelated sweep, since `boardSweep.ts` ranks on
 * the same number.
 */
export function countsWholeBoard(provider: AtsProvider, query: string): boolean {
  const adapter = adapterFor(provider)
  // No adapter means no outcome worth counting either; the caller is about to
  // record an error, not a size.
  if (!adapter) return true
  return !adapter.serverSideQuery || query.trim() === ''
}

/**
 * The count to write into the row, or null to leave the stored one alone.
 *
 * A query-filtered fetch still updates when the board was last checked and
 * whether it is failing — those are true of the board however it was asked —
 * but it has nothing to say about how many roles the board holds, and a
 * silence is more accurate there than a number that answers a different
 * question.
 */
export function recordedJobCount(
  outcome: AtsBoardFetchOutcome,
  provider: AtsProvider,
  query: string
): number | null {
  return countsWholeBoard(provider, query) ? fetchedJobCount(outcome) : null
}

/** The row's error text, or null when the board answered (including with nothing open). */
export function fetchErrorMessage(outcome: AtsBoardFetchOutcome): string | null {
  if (outcome.status === 'not_found') return BOARD_NOT_FOUND_MESSAGE
  if (outcome.status === 'error') return outcome.message
  return null
}

/**
 * Persisting the outcome is bookkeeping on top of whatever the caller
 * actually asked for, so a database hiccup here is logged and swallowed
 * rather than failing a search that already has its results, or a refresh
 * whose numbers the caller is about to report anyway.
 */
export function recordBoardFetchOutcome(
  board: CompanyBoardRecord,
  outcome: AtsBoardFetchOutcome,
  /** The query this outcome answers; '' for a census of the whole board. */
  query: string
): void {
  try {
    recordCompanyBoardFetch(board.boardKey, {
      jobCount: recordedJobCount(outcome, board.provider, query),
      error: fetchErrorMessage(outcome)
    })
  } catch (err) {
    appLogger.warn(`Failed to record board fetch for ${board.boardKey}: ${String(err)}`)
  }
}

import { ATS_FETCH_CONCURRENCY, MANUAL_BOARD_FETCH_LIMIT } from '@shared/constants'
import { appLogger } from '../../logger'
import { boardCacheKey, writeBoardCache } from './boardCache'
import { fetchedJobCount, fetchErrorMessage, recordBoardFetchOutcome } from './boardFetchRecord'
import { mapWithConcurrency } from './http'
import { adapterFor } from './providers'
import type { BoardFetchOutcome, CompanyBoardRecord } from '@shared/types/companyBoard'
import type { AtsBoardFetchOutcome } from './types'

/**
 * Fetching tracked boards on demand, rather than as a side effect of a
 * search.
 *
 * A board's "Last result" column is only written when something fetches it,
 * so until the first `search_jobs` call every board a user adds reads "Not
 * searched yet" — including the ones that were added from a CSV and have
 * never been confirmed to exist. This is how someone checks a board now:
 * whether the slug answers at all, and how much it is carrying, without
 * running a job search to find out.
 *
 * Two deliberate differences from the search path:
 *
 * - The cache is written but never read. The whole point of pressing the
 *   button is to ask the provider again, so serving a 15-minute-old answer
 *   would make it look broken. The fresh answer is cached, so a search a
 *   moment later reuses it instead of asking twice.
 * - Paused boards are fetched too. A search skips them by definition, and
 *   "check this before I turn it back on" is exactly when a manual fetch is
 *   worth having.
 */

/** Empty query: this is a census of the board, not a search of it. */
const REFRESH_QUERY = ''

async function fetchOne(board: CompanyBoardRecord): Promise<AtsBoardFetchOutcome> {
  const adapter = adapterFor(board.provider)
  if (!adapter) return { status: 'error', message: `Unknown ATS provider: ${board.provider}` }

  try {
    return await adapter.fetchBoard(board, {
      query: REFRESH_QUERY,
      limit: MANUAL_BOARD_FETCH_LIMIT,
      companyName: board.companyName
    })
  } catch (err) {
    // Adapters return outcomes rather than throwing, but one unexpected throw
    // must not take down a refresh across every other selected board.
    return { status: 'error', message: String(err) }
  }
}

/**
 * Fetches each board once, records what came back, and reports it per board
 * so the caller can say which ones answered and which did not. Order matches
 * the input.
 *
 * `onResult` fires the moment each board lands, before the rest of the batch
 * finishes. The fetches already run in parallel, so without it the *reporting*
 * would be the serial part: a selection of forty boards would sit with every
 * row spinning until the slowest one returned, even though most of them
 * answered in the first second. A throw from it is swallowed rather than
 * failing the board it is reporting on — it is a notification, not the work.
 */
export async function refreshBoards(
  boards: readonly CompanyBoardRecord[],
  onResult?: (result: BoardFetchOutcome) => void
): Promise<BoardFetchOutcome[]> {
  return mapWithConcurrency(boards, ATS_FETCH_CONCURRENCY, async (board) => {
    const outcome = await fetchOne(board)

    try {
      writeBoardCache(boardCacheKey(board, REFRESH_QUERY, MANUAL_BOARD_FETCH_LIMIT), outcome)
    } catch (err) {
      // The cache is a nicety; failing to write it must not lose the fetch.
      appLogger.warn(`Failed to cache refreshed board ${board.boardKey}: ${String(err)}`)
    }
    // Fetched with the empty query above, so this outcome counts the whole
    // board on every provider — which is the point of the button.
    recordBoardFetchOutcome(board, outcome, REFRESH_QUERY)

    const result: BoardFetchOutcome = {
      id: board.id,
      companyName: board.companyName,
      provider: board.provider,
      status: outcome.status,
      jobCount: fetchedJobCount(outcome),
      message: fetchErrorMessage(outcome)
    }

    try {
      onResult?.(result)
    } catch (err) {
      appLogger.warn(`Failed to report refreshed board ${board.boardKey}: ${String(err)}`)
    }

    return result
  })
}

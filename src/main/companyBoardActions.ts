import { resolveCompanyBoard } from './browser/ats/resolveBoard'
import { boardKeyOf } from './browser/ats/providers'
import { clearBoardCache } from './browser/ats/boardCache'
import { refreshBoards } from './browser/ats/refreshBoards'
import {
  addCompanyBoard,
  getCompanyBoardByKey,
  getCompanyBoardsByIds,
  importCompanyBoards,
  removeCompanyBoard,
  removeCompanyBoards,
  setCompanyBoardEnabled,
  setCompanyBoardsEnabled
} from './db/repositories/companyBoardsRepository'
import { broadcastCompanyBoardFetched, broadcastCompanyBoardsChanged } from './ipc/jobsBroadcast'
import { logActivity } from './db/repositories/activityLogRepository'
import type {
  AtsProvider,
  BoardCsvImportSummary,
  BoardFetchOutcome,
  BoardProbeCandidate,
  CompanyBoardRecord
} from '@shared/types/companyBoard'
import type { CsvBoardCandidate } from './dataTransfer/companyBoardCsv'

/**
 * Adding, enabling and removing a tracked board, shared by the IPC handlers
 * (the Company Boards panel) and the agent's `add_company_board` tool — the
 * same reasoning as `jobActions.excludeJob`: two entry points, one behaviour,
 * one place that remembers to invalidate the cache and tell the renderer.
 */

export interface AddBoardRequest {
  /** A company name, a domain, or a board/posting URL. */
  query: string
  /**
   * With `token`, the board itself — resolution is skipped. Without one, a
   * hint: the caller believes the company is on this ATS but doesn't know the
   * slug, so every provider is still probed and this one only breaks a tie
   * (see `resolveBoard`'s ranking, where a provider that actually has
   * postings always wins over a preference).
   */
  provider?: AtsProvider
  token?: string
  /** Overrides the display name, which otherwise falls back to the resolved slug. */
  companyName?: string
  addedBy: 'user' | 'agent'
}

export type AddBoardOutcome =
  | {
      status: 'added' | 'already_tracked'
      board: CompanyBoardRecord
      /** Postings seen while resolving — 0 is a live board with nothing open, not a failure. */
      jobCount: number
      /** False when the board couldn't be reached to confirm; it is tracked anyway. */
      verified: boolean
      /** More than one provider held postings for this company (an ATS migration in progress). */
      ambiguous: boolean
      candidates: BoardProbeCandidate[]
    }
  | { status: 'not_found'; triedTokens: string[] }
  | { status: 'limit_reached'; limit: number }
  | { status: 'error'; message: string }

export async function addBoard(request: AddBoardRequest): Promise<AddBoardOutcome> {
  const hasToken = request.token !== undefined && request.token.trim() !== ''
  const resolved = await resolveCompanyBoard({
    query: request.query,
    // A provider without a token cannot address a board, so it is passed as
    // the preference rather than as an identity — the difference between
    // "this is the board" and "the careers page points at this ATS".
    provider: hasToken ? request.provider : undefined,
    token: hasToken ? request.token : undefined,
    preferProvider: hasToken ? undefined : request.provider,
    companyName: request.companyName
  })

  if (resolved.status !== 'resolved') return resolved

  const boardKey = boardKeyOf(resolved.descriptor)
  const stored = addCompanyBoard({
    ...resolved.descriptor,
    boardKey,
    companyName: resolved.companyName,
    addedBy: request.addedBy
  })

  if (stored.status === 'limit_reached') return stored

  if (stored.status === 'added') {
    // A board resolved a second ago was fetched a second ago, and the search
    // that follows should show it straight away rather than after the cache
    // expires. Clearing everything is fine: the cache is a nicety, and this
    // happens once per board added.
    clearBoardCache()
    logActivity('info', `Tracking ${resolved.companyName}'s ${resolved.descriptor.provider} board`, {
      boardKey,
      jobCount: resolved.jobCount,
      addedBy: request.addedBy
    })
    broadcastCompanyBoardsChanged()
  }

  return {
    status: stored.status,
    board: stored.board,
    jobCount: resolved.jobCount,
    verified: resolved.verified,
    ambiguous: resolved.ambiguous,
    candidates: resolved.candidates
  }
}

export function removeBoard(id: string): boolean {
  const removed = removeCompanyBoard(id)
  if (removed) {
    clearBoardCache()
    broadcastCompanyBoardsChanged()
  }
  return removed
}

export function setBoardEnabled(id: string, enabled: boolean): CompanyBoardRecord | null {
  const board = setCompanyBoardEnabled(id, enabled)
  if (board) broadcastCompanyBoardsChanged()
  return board
}

/**
 * The bulk forms of Pause/Resume and Remove, for a selection in the
 * watchlist. One write and one broadcast each, rather than a loop of
 * single-board calls that would make the list reload once per board.
 */
export function setBoardsEnabled(ids: readonly string[], enabled: boolean): number {
  const updated = setCompanyBoardsEnabled(ids, enabled)
  if (updated > 0) broadcastCompanyBoardsChanged()
  return updated
}

export function removeBoards(ids: readonly string[]): number {
  const removed = removeCompanyBoards(ids)
  if (removed > 0) {
    clearBoardCache()
    broadcastCompanyBoardsChanged()
  }
  return removed
}

/**
 * Fetches the given boards now and writes back what each one answered.
 *
 * The counterpart to a board's "Last result" only ever being filled in by a
 * search: a freshly added board (and every board a CSV import brought in)
 * reads "Not searched yet" until something goes and looks, and this is how
 * someone makes that happen for one board or for a selection of them.
 *
 * Ids that no longer exist are dropped rather than reported: the list is
 * live, and a board removed between selecting it and pressing the button is
 * not a failure of the fetch.
 */
export async function fetchBoardsNow(ids: readonly string[]): Promise<BoardFetchOutcome[]> {
  const boards = getCompanyBoardsByIds(ids)
  if (boards.length === 0) return []

  const byId = new Map(boards.map((board) => [board.id, board]))

  // Each board is announced as it lands rather than with the batch: the
  // fetches already overlap, and holding every result until the slowest one
  // returns would be the only serial step in an otherwise parallel operation.
  const results = await refreshBoards(boards, (result) => {
    const boardKey = byId.get(result.id)?.boardKey
    // Read back rather than patched together here, so the row the panel shows
    // is the row that was actually written.
    const board = boardKey ? getCompanyBoardByKey(boardKey) : null
    broadcastCompanyBoardFetched({ result, board })
  })

  const failed = results.filter((result) => result.status !== 'ok').length
  logActivity('info', `Checked ${results.length} company board(s)`, {
    boards: results.length,
    failed,
    roles: results.reduce((total, result) => total + result.jobCount, 0)
  })

  // A reconciliation, not the primary signal: the per-board pushes above have
  // already updated each row, and this catches anything that missed them — a
  // panel that mounted mid-batch, or a row changed by something else while
  // this ran.
  broadcastCompanyBoardsChanged()

  return results
}

/**
 * Writes a planned CSV import, and lives beside `addBoard` for the reason
 * that one does: adding boards means invalidating the board cache, logging,
 * and telling the renderer, and no entry point should have to remember that
 * list for itself.
 *
 * Every board arrives unchecked — no probe, no fetch. A bulk import from a
 * published feed is hundreds of boards, and confirming each would be hundreds
 * of requests fired at four hosts before the user has seen a single result.
 * The first search checks them and the watchlist's "Last result" column
 * reports back, which is the same path a board added by URL already takes
 * when it can't be reached at the time it is added.
 *
 * The counts the plan already made are passed in rather than recomputed: the
 * repository only sees the rows that reached it, and the summary has to
 * account for every row of the file, so `imported + alreadyTracked + skipped`
 * comes back equal to `totalRows`.
 */
export function importCsvBoards(
  boards: readonly CsvBoardCandidate[],
  planned: { totalRows: number; alreadyTracked: number; skippedRows: number }
): BoardCsvImportSummary {
  const createdAt = new Date().toISOString()
  const result = importCompanyBoards(
    boards.map((board) => ({
      ...board.descriptor,
      boardKey: board.boardKey,
      companyName: board.companyName,
      addedBy: 'user' as const,
      enabled: true,
      // Carried into the row rather than only used to rank the import: with
      // nothing fetched yet, this is the only thing that can order the first
      // sweeps of a few hundred new boards (see `ats/boardSweep.ts`).
      seedJobCount: board.openPostings,
      createdAt
    }))
  )

  // A board that turned up as already tracked between the preview and the
  // write is counted with the ones the plan already knew about, not as a
  // mysterious skip.
  const alreadyTracked = planned.alreadyTracked + result.alreadyTracked
  const skipped = planned.skippedRows + result.overLimit

  if (result.imported > 0) {
    clearBoardCache()
    logActivity('info', `Imported ${result.imported} company boards from CSV`, {
      imported: result.imported,
      alreadyTracked,
      skipped,
      totalRows: planned.totalRows
    })
    broadcastCompanyBoardsChanged()
  }

  return { totalRows: planned.totalRows, imported: result.imported, alreadyTracked, skipped }
}

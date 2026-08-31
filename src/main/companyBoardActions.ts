import { resolveCompanyBoard } from './browser/ats/resolveBoard'
import { boardKeyOf } from './browser/ats/providers'
import { clearBoardCache } from './browser/ats/boardCache'
import { addCompanyBoard, removeCompanyBoard, setCompanyBoardEnabled } from './db/repositories/companyBoardsRepository'
import { broadcastCompanyBoardsChanged } from './ipc/jobsBroadcast'
import { logActivity } from './db/repositories/activityLogRepository'
import type { AtsProvider, BoardProbeCandidate, CompanyBoardRecord } from '@shared/types/companyBoard'

/**
 * Adding, enabling and removing a tracked board, shared by the IPC handlers
 * (the Company Boards panel) and the agent's `add_company_board` tool — the
 * same reasoning as `jobActions.excludeJob`: two entry points, one behaviour,
 * one place that remembers to invalidate the cache and tell the renderer.
 */

export interface AddBoardRequest {
  /** A company name, a domain, or a board/posting URL. */
  query: string
  /** Skips resolution when paired with `token` — the caller already knows the board. */
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
  const resolved = await resolveCompanyBoard({
    query: request.query,
    provider: request.provider,
    token: request.token,
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

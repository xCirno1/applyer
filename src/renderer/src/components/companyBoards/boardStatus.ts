import type { CompanyBoardRecord } from '@shared/types/companyBoard'

/**
 * What the last fetch of a board came back with. Kept as a plain module (no
 * React) for the same reason as `workspace/workspaceLayout.ts`: the rules
 * here are the interesting part of the row, and "0 open roles" being a real
 * answer rather than a failure is exactly the kind of thing worth pinning
 * down in a test.
 */
export type BoardStatus =
  | { kind: 'error'; message: string }
  | { kind: 'unchecked' }
  | { kind: 'roles'; count: number }

type StatusFields = Pick<CompanyBoardRecord, 'lastError' | 'lastCheckedAt' | 'lastJobCount'>

/**
 * An error outranks a count: a board that answered once and has since started
 * failing still carries the old count, and showing it would present a stale
 * reading as current. A blank error string is not an error, since it would
 * put an empty cell where an explanation belongs.
 */
export function boardStatus(board: StatusFields): BoardStatus {
  const message = board.lastError?.trim()
  if (message) return { kind: 'error', message }
  if (board.lastCheckedAt === null) return { kind: 'unchecked' }
  return { kind: 'roles', count: safeCount(board.lastJobCount) }
}

/**
 * The count comes from whatever the provider's API returned on the last
 * search, so it is never assumed to be a sane non-negative integer.
 */
function safeCount(value: number | null): number {
  if (value === null || !Number.isFinite(value) || value <= 0) return 0
  return Math.floor(value)
}

export interface BoardAddress {
  /** The slug (Greenhouse/Lever/Ashby) or tenant (Workday) the board is fetched by. */
  token: string
  /** Workday's career-site id, or null for the three slug-only providers. */
  site: string | null
  /** Every part of the address, for a hover title on a cell that truncates. */
  full: string
}

/**
 * How a board is addressed, for display. Workday needs three parts (host,
 * tenant, career site) where the others need one, so the cell shows the token
 * with the site beside it and keeps the host for the hover title.
 */
export function boardAddress(board: Pick<CompanyBoardRecord, 'token' | 'host' | 'site'>): BoardAddress {
  const token = board.token.trim()
  const site = board.site?.trim() || null
  const host = board.host?.trim() || null
  return { token, site, full: [host, token, site].filter(Boolean).join(' / ') }
}

/**
 * How the last result is ordered when the status column is sorted.
 *
 * That column shows a sentence, so sorting it as text would order boards by
 * the first letter of a provider's error message. Ranking instead puts the
 * boards that need attention (failing, then never searched) ahead of the ones
 * that answered, and orders the rest by how much they are contributing.
 */
export function boardStatusRank(status: BoardStatus): number {
  if (status.kind === 'error') return -2
  if (status.kind === 'unchecked') return -1
  return status.count
}

/**
 * The bucket a board falls into for the status filter. Paused outranks
 * everything else: a paused board's last result is stale by definition, so
 * filing it under that result would list it among the boards the next search
 * is actually going to visit.
 */
export type BoardFilterStatus = 'paused' | 'error' | 'unchecked' | 'empty' | 'open'

type FilterFields = StatusFields & Pick<CompanyBoardRecord, 'enabled'>

export function boardFilterStatus(board: FilterFields): BoardFilterStatus {
  if (!board.enabled) return 'paused'
  const status = boardStatus(board)
  if (status.kind === 'error') return 'error'
  if (status.kind === 'unchecked') return 'unchecked'
  return status.count > 0 ? 'open' : 'empty'
}

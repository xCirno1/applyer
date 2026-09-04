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
  | { kind: 'uncounted' }
  | { kind: 'roles'; count: number }

type StatusFields = Pick<CompanyBoardRecord, 'lastError' | 'lastCheckedAt' | 'lastJobCount'>

/**
 * An error outranks a count: a board that answered once and has since started
 * failing still carries the old count, and showing it would present a stale
 * reading as current. A blank error string is not an error, since it would
 * put an empty cell where an explanation belongs.
 *
 * "Checked, but with no count" is its own answer rather than a count of zero.
 * A Workday board is filtered by Workday, so a keyword search reaches it
 * without ever counting it (see `boardFetchRecord.countsWholeBoard`), and
 * until something does the honest thing to say is that nobody has counted —
 * not that the board is empty, which is a claim about a company that may be
 * hiring for two hundred roles.
 */
export function boardStatus(board: StatusFields): BoardStatus {
  const message = board.lastError?.trim()
  if (message) return { kind: 'error', message }
  if (board.lastCheckedAt === null) return { kind: 'unchecked' }
  if (board.lastJobCount === null) return { kind: 'uncounted' }
  return { kind: 'roles', count: safeCount(board.lastJobCount) }
}

/**
 * The count comes from whatever the provider's API returned on the last
 * search, so it is never assumed to be a sane non-negative integer.
 */
function safeCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
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

const RANK_ERROR = Number.MAX_SAFE_INTEGER
const RANK_UNCHECKED = RANK_ERROR - 1
const RANK_UNCOUNTED = RANK_ERROR - 2
/**
 * Ceiling for a real count. The number is a provider's, not ours, so a board
 * claiming an absurd one must not be able to climb into the tiers above and
 * pass itself off as a failing board.
 */
const RANK_MAX_ROLES = RANK_ERROR - 3

/**
 * How the last result is ordered when the status column is sorted.
 *
 * That column shows a sentence, so sorting it as text would order boards by
 * the first letter of a provider's error message. Ranking instead puts the
 * boards that need attention (failing, then the ones nothing has a reading
 * for) ahead of the ones that answered, and orders the rest by how much they
 * are contributing.
 *
 * The tiers run *above* the counts rather than below them because a column
 * that is not sorted yet starts descending on its first click (see
 * `nextSortDir`): the boards that need attention have to carry the largest
 * values to come out on top of that click, which is the one this ordering
 * exists for. Sorting the other way is then the same list upside down, with
 * the healthiest boards first, which is a reasonable second question to ask.
 */
export function boardStatusRank(status: BoardStatus): number {
  if (status.kind === 'error') return RANK_ERROR
  if (status.kind === 'unchecked') return RANK_UNCHECKED
  if (status.kind === 'uncounted') return RANK_UNCOUNTED
  return Math.min(status.count, RANK_MAX_ROLES)
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
  // Both of the states with no reading behind them file here, since the
  // question this bucket answers is "which boards is there still nothing to
  // show for?" — splitting them would put a sixth entry in the dropdown to
  // separate two rows a person would look at for the same reason.
  if (status.kind === 'unchecked' || status.kind === 'uncounted') return 'unchecked'
  return status.count > 0 ? 'open' : 'empty'
}

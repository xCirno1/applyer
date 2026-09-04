import { ATS_SWEEP_ROTATION_SHARE } from '@shared/constants'
import type { CompanyBoardRecord } from '@shared/types/companyBoard'

/**
 * Choosing which tracked boards a single search actually fetches.
 *
 * There is a budget — `MAX_ATS_BOARDS_PER_SEARCH`, one request per board —
 * and a watchlist that can hold eight times that, so every search is a
 * choice. It used to be made by insertion order, which is the one ordering
 * that carries no information: with 200 boards tracked, the same 25 were
 * fetched every time and the other 175 were never reached at all, so a board
 * added after the first 25 could not contribute a posting no matter how much
 * it was hiring.
 *
 * Two things decide it instead, because either alone fails:
 *
 * - **Size.** Postings per board are heavily skewed (a published feed's top
 *   500 of 10,000 boards hold half of all open postings), so spending the
 *   budget on the boards known to carry the most roles is what makes a
 *   fixed number of requests return the most jobs.
 * - **Rotation.** Ranking on size alone is self-fulfilling: a board that has
 *   never been fetched has no size, so it would never be picked, so it would
 *   never get one — and a board that was empty in January would never be
 *   looked at again in June. A minority of the budget is therefore reserved
 *   for the boards nothing has looked at in longest, which is also what gets
 *   a freshly imported watchlist measured at all. Those boards are ordered by
 *   what the feed they came from claimed they hold (`seedJobCount`), since
 *   "never fetched" is a tie every one of them is in.
 *
 * Plain functions over records, no database and no network, so the rule that
 * decides what a search can see is testable on its own.
 */

/**
 * What a *feed* claimed a board holds, for the boards nothing has fetched yet.
 *
 * A bulk import arrives with a count per row and no reading of our own, and
 * postings per board are heavily skewed, so ordering the unmeasured boards by
 * that claim is the difference between a first sweep that reaches the largest
 * employers in the file and one that reaches whichever boards sort first
 * alphabetically. It is deliberately never mixed with `boardContribution`:
 * a measured 0 outranks a claimed 500, because one of them is a fact about
 * the board today and the other is what a third-party file said.
 */
export function seedContribution(board: CompanyBoardRecord): number {
  const seed = board.seedJobCount
  if (seed === null || !Number.isFinite(seed) || seed < 0) return -1
  return Math.floor(seed)
}

/** What a board is known to contribute, or null when nothing has measured it yet. */
export function boardContribution(board: CompanyBoardRecord): number | null {
  // A board that failed contributes nothing right now, whatever count it may
  // still be carrying from before it started failing.
  if (board.lastError !== null && board.lastError.trim() !== '') return 0
  if (board.lastCheckedAt === null) return null
  const count = board.lastJobCount
  // Checked, but with no count behind it: a Workday board only ever reached
  // by keyword searches has been contacted without anything ever counting it
  // (see `boardFetchRecord.countsWholeBoard`). That is an unknown size, not a
  // size of zero, and reading it as zero would park the board at the bottom
  // of every sweep it could otherwise have led.
  if (count === null) return null
  if (!Number.isFinite(count) || count < 0) return 0
  return Math.floor(count)
}

/** Biggest claimed board first among boards with no reading; no claim sorts last. */
function bySeed(a: CompanyBoardRecord, b: CompanyBoardRecord): number {
  return seedContribution(b) - seedContribution(a)
}

/** How long a board has gone unlooked-at; never-checked sorts first. */
function stalenessKey(board: CompanyBoardRecord): number {
  if (board.lastCheckedAt === null) return -Infinity
  const parsed = Date.parse(board.lastCheckedAt)
  // An unparseable timestamp is not a reading, so it is treated as no reading.
  return Number.isFinite(parsed) ? parsed : -Infinity
}

/** Deterministic last resort, so the same watchlist always yields the same sweep. */
function byKey(a: CompanyBoardRecord, b: CompanyBoardRecord): number {
  return a.boardKey.localeCompare(b.boardKey)
}

export interface BoardSweepPlan {
  /** The boards to fetch, biggest known contributors first. */
  boards: CompanyBoardRecord[]
  /** Tracked boards this sweep did not reach. */
  skipped: number
  /** Of the picks, how many were taken for their size and how many to keep the list moving. */
  pickedBySize: number
  pickedByRotation: number
}

export function selectBoardsForSweep(tracked: readonly CompanyBoardRecord[], limit: number): BoardSweepPlan {
  const budget = Math.max(0, Math.floor(limit))
  if (budget === 0 || tracked.length === 0) {
    return { boards: [], skipped: tracked.length, pickedBySize: 0, pickedByRotation: 0 }
  }

  // Everything fits: there is nothing to choose, only an order to fetch in.
  if (tracked.length <= budget) {
    const boards = [...tracked].sort(compareBySize)
    return { boards, skipped: 0, pickedBySize: boards.length, pickedByRotation: 0 }
  }

  const rotationSlots = Math.min(budget - 1, Math.max(1, Math.round(budget * ATS_SWEEP_ROTATION_SHARE)))
  const sizeSlots = budget - rotationSlots

  const picked = new Set<string>()
  const bySize: CompanyBoardRecord[] = []

  // Only measured boards can be ranked by size; an unmeasured one is not a
  // small board, it is an unknown one, and it belongs to rotation.
  for (const board of [...tracked].filter((board) => boardContribution(board) !== null).sort(compareBySize)) {
    if (bySize.length >= sizeSlots) break
    bySize.push(board)
    picked.add(board.boardKey)
  }

  const byRotation: CompanyBoardRecord[] = []
  // Whatever size could not fill (a watchlist nothing has measured yet) rolls
  // into rotation rather than being left unspent.
  const remainingSlots = budget - bySize.length
  for (const board of [...tracked]
    .filter((board) => !picked.has(board.boardKey))
    // Staleness first, as before — but every never-fetched board ties there
    // (they are all equally unlooked-at), and that tie used to be broken by
    // board key, i.e. alphabetically. A freshly imported watchlist is nothing
    // but such ties, so the claimed size is what orders it until the app has
    // measurements of its own.
    .sort((a, b) => stalenessKey(a) - stalenessKey(b) || bySeed(a, b) || byKey(a, b))) {
    if (byRotation.length >= remainingSlots) break
    byRotation.push(board)
    picked.add(board.boardKey)
  }

  const boards = [...bySize, ...byRotation].sort(compareBySize)
  return {
    boards,
    skipped: tracked.length - boards.length,
    pickedBySize: bySize.length,
    pickedByRotation: byRotation.length
  }
}

/**
 * Most known roles first; unmeasured boards after every measured one, and
 * among themselves by what their feed claimed.
 */
function compareBySize(a: CompanyBoardRecord, b: CompanyBoardRecord): number {
  const left = boardContribution(a)
  const right = boardContribution(b)
  if (left === null && right === null) return bySeed(a, b) || byKey(a, b)
  if (left === null) return 1
  if (right === null) return -1
  if (left === right) return byKey(a, b)
  return right - left
}

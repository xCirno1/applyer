import { randomUUID } from 'crypto'
import { and, asc, eq, inArray, or, sql, type SQL } from 'drizzle-orm'
import { getDb } from '../index'
import { likeContains } from './likeSearch'
import { companyBoards } from '../schema'
import { LIST_COMPANY_BOARDS_DEFAULT_LIMIT, LIST_COMPANY_BOARDS_MAX_LIMIT, MAX_COMPANY_BOARDS } from '@shared/constants'
import type {
  AtsBoardDescriptor,
  AtsProvider,
  CompanyBoardRecord,
  ListCompanyBoardsQuery,
  ListCompanyBoardsResult
} from '@shared/types/companyBoard'

type BoardRow = typeof companyBoards.$inferSelect

function toRecord(row: BoardRow): CompanyBoardRecord {
  return {
    id: row.id,
    boardKey: row.boardKey,
    provider: row.provider as AtsProvider,
    token: row.token,
    host: row.host,
    site: row.site,
    companyName: row.companyName,
    addedBy: row.addedBy as 'user' | 'agent',
    enabled: row.enabled,
    lastCheckedAt: row.lastCheckedAt,
    lastJobCount: row.lastJobCount,
    seedJobCount: row.seedJobCount,
    lastError: row.lastError,
    createdAt: row.createdAt
  }
}

export interface AddCompanyBoardInput extends AtsBoardDescriptor {
  boardKey: string
  companyName: string
  addedBy: 'user' | 'agent'
  /**
   * Open roles a feed claimed for this board, when it came from one. Stored
   * as-is and never treated as a fetch — see `seedJobCount` on the record.
   */
  seedJobCount?: number | null
}

/** Only a whole, non-negative count is a usable seed; anything else is no claim at all. */
function normaliseSeedJobCount(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  if (!Number.isFinite(value) || value < 0) return null
  return Math.floor(value)
}

export type AddCompanyBoardResult =
  | { status: 'added'; board: CompanyBoardRecord }
  /** The same board was already tracked — adding again is a no-op, not an error. */
  | { status: 'already_tracked'; board: CompanyBoardRecord }
  | { status: 'limit_reached'; limit: number }

export function getCompanyBoardByKey(boardKey: string): CompanyBoardRecord | null {
  const row = getDb().select().from(companyBoards).where(eq(companyBoards.boardKey, boardKey)).get()
  return row ? toRecord(row) : null
}

/**
 * The boards behind a set of row ids, for an action scoped to a selection.
 * Ids that no longer exist are simply absent rather than an error: the list
 * is live, and a board can be removed between selecting it and acting on it.
 */
export function getCompanyBoardsByIds(ids: readonly string[]): CompanyBoardRecord[] {
  if (ids.length === 0) return []
  return getDb()
    .select()
    .from(companyBoards)
    .where(inArray(companyBoards.id, [...ids]))
    .all()
    .map(toRecord)
}

export function countCompanyBoards(): number {
  return getDb().select({ count: sql<number>`count(*)` }).from(companyBoards).get()?.count ?? 0
}

/**
 * Every tracked board's key, as a set to test membership against.
 *
 * For one board, `getCompanyBoardByKey` is the right question; for a whole
 * file it is not. A CSV import asks "is this tracked?" once per candidate row
 * and re-asks on every mapping change, so at the allowed file size that is
 * tens of thousands of synchronous SELECTs on the main process — enough to
 * stall every other IPC call behind it. The watchlist is bounded by
 * `MAX_COMPANY_BOARDS`, so the whole key column is a few hundred short
 * strings and one read answers all of them.
 */
export function listCompanyBoardKeys(): Set<string> {
  const rows = getDb().select({ boardKey: companyBoards.boardKey }).from(companyBoards).all()
  return new Set(rows.map((row) => row.boardKey))
}

export function addCompanyBoard(input: AddCompanyBoardInput): AddCompanyBoardResult {
  const db = getDb()

  const existing = db.select().from(companyBoards).where(eq(companyBoards.boardKey, input.boardKey)).get()
  if (existing) return { status: 'already_tracked', board: toRecord(existing) }

  // Every tracked board is one outbound request per search, so the ceiling is
  // what stops an agent looping on `add_company_board` from turning a single
  // search into a thousand requests.
  if (countCompanyBoards() >= MAX_COMPANY_BOARDS) {
    return { status: 'limit_reached', limit: MAX_COMPANY_BOARDS }
  }

  const id = randomUUID()
  db.insert(companyBoards)
    .values({
      id,
      boardKey: input.boardKey,
      provider: input.provider,
      token: input.token,
      host: input.host,
      site: input.site,
      companyName: input.companyName,
      addedBy: input.addedBy,
      seedJobCount: normaliseSeedJobCount(input.seedJobCount)
    })
    .run()

  const row = db.select().from(companyBoards).where(eq(companyBoards.id, id)).get()
  if (!row) throw new Error('Failed to read back inserted company board')
  return { status: 'added', board: toRecord(row) }
}

export function listCompanyBoards(query: ListCompanyBoardsQuery): ListCompanyBoardsResult {
  const db = getDb()
  const limit = Math.min(Math.max(1, query.limit ?? LIST_COMPANY_BOARDS_DEFAULT_LIMIT), LIST_COMPANY_BOARDS_MAX_LIMIT)
  const offset = Math.max(0, query.offset ?? 0)

  const term = query.search?.trim()
  const whereClause: SQL<unknown> | undefined = term
    ? or(likeContains(companyBoards.companyName, term), likeContains(companyBoards.token, term))
    : undefined

  const rows = db
    .select()
    .from(companyBoards)
    .where(whereClause)
    // Alphabetical, not newest-first: this is a watchlist the user scans for a
    // known company, not a feed of recent events.
    .orderBy(asc(sql`lower(${companyBoards.companyName})`), asc(companyBoards.boardKey))
    .limit(limit)
    .offset(offset)
    .all()

  const totalRow = db.select({ count: sql<number>`count(*)` }).from(companyBoards).where(whereClause).get()

  return { boards: rows.map(toRecord), total: totalRow?.count ?? 0 }
}

/** Every board a search should fetch, optionally narrowed to the providers the caller asked for. */
export function listSearchableCompanyBoards(providers?: readonly AtsProvider[]): CompanyBoardRecord[] {
  const conditions: SQL<unknown>[] = [eq(companyBoards.enabled, true)]

  if (providers) {
    // An empty provider list means "none of them" — returning every board
    // here would search sources the caller explicitly didn't ask for.
    if (providers.length === 0) return []
    const providerMatch = or(...providers.map((provider) => eq(companyBoards.provider, provider)))
    if (providerMatch) conditions.push(providerMatch)
  }

  return getDb()
    .select()
    .from(companyBoards)
    .where(and(...conditions))
    .orderBy(asc(companyBoards.createdAt), asc(companyBoards.boardKey))
    .all()
    .map(toRecord)
}

export function setCompanyBoardEnabled(id: string, enabled: boolean): CompanyBoardRecord | null {
  const db = getDb()
  db.update(companyBoards).set({ enabled }).where(eq(companyBoards.id, id)).run()
  const row = db.select().from(companyBoards).where(eq(companyBoards.id, id)).get()
  return row ? toRecord(row) : null
}

export function removeCompanyBoard(id: string): boolean {
  return getDb().delete(companyBoards).where(eq(companyBoards.id, id)).run().changes > 0
}

/**
 * The bulk forms of the two row actions, for a selection.
 *
 * One statement rather than a loop of single-row calls, so a selection of
 * fifty boards is one write and one "the list changed" broadcast instead of
 * fifty of each — the same reasoning as `jobsRepository`'s `retryMany`.
 * Both return how many rows actually changed, since ids can go stale.
 */
export function setCompanyBoardsEnabled(ids: readonly string[], enabled: boolean): number {
  if (ids.length === 0) return 0
  return getDb()
    .update(companyBoards)
    .set({ enabled })
    .where(inArray(companyBoards.id, [...ids]))
    .run().changes
}

export function removeCompanyBoards(ids: readonly string[]): number {
  if (ids.length === 0) return 0
  return getDb()
    .delete(companyBoards)
    .where(inArray(companyBoards.id, [...ids]))
    .run().changes
}

/**
 * Records what the last fetch of a board actually did, so the UI can show a
 * board that has quietly stopped answering (a retired slug, a migration)
 * instead of it just contributing nothing to every search.
 *
 * `jobCount: 0` with no error is a real state and is stored as such — a live
 * board with nothing open right now. `jobCount: null` is a different one:
 * the board was reached, but by a request that cannot count it.
 */
export function recordCompanyBoardFetch(
  boardKey: string,
  outcome: { jobCount: number | null; error?: string | null },
  now: string = new Date().toISOString()
): void {
  getDb()
    .update(companyBoards)
    .set({
      lastCheckedAt: now,
      // A null count means "this fetch cannot speak for the whole board" — a
      // Workday search is filtered by the provider, so its numbers answer the
      // query rather than describing the board (see `countsWholeBoard`). The
      // column then keeps the last count something actually counted, instead
      // of being overwritten with an unrelated one.
      ...(outcome.jobCount === null ? {} : { lastJobCount: outcome.jobCount }),
      lastError: outcome.error ?? null
    })
    .where(eq(companyBoards.boardKey, boardKey))
    .run()
}

/** Unpaginated read for a one-shot export, mirroring `listAllExclusions`. */
export function listAllCompanyBoards(): CompanyBoardRecord[] {
  return getDb().select().from(companyBoards).orderBy(asc(companyBoards.createdAt)).all().map(toRecord)
}

/**
 * `skipped` is the sum of the two reasons a row can be dropped, kept as its
 * own field because the JSON bundle import reports one number while the CSV
 * import distinguishes "you already track this" from "the watchlist is full".
 */
export interface ImportCompanyBoardsResult {
  imported: number
  skipped: number
  alreadyTracked: number
  overLimit: number
}

/**
 * Adds imported boards alongside whatever is already tracked, mirroring
 * `importExclusions` — an import merges a watchlist, it never replaces one.
 *
 * Two things differ from a plain insert loop. The ceiling is re-checked per
 * row rather than once up front, because it counts what is in the table now
 * and each accepted row moves it; and every board arrives unchecked, since
 * `lastCheckedAt`/`lastJobCount`/`lastError` describe what the *exporting*
 * machine saw and would otherwise be shown here as a current reading.
 *
 * `boardKey` is recomputed by the caller from the descriptor rather than read
 * from the file, so a hand-edited bundle cannot file a board under a key that
 * contradicts its own provider and token.
 */
export function importCompanyBoards(
  records: readonly (AddCompanyBoardInput & { createdAt: string; enabled: boolean })[]
): ImportCompanyBoardsResult {
  const db = getDb()
  let imported = 0
  let alreadyTracked = 0
  let overLimit = 0

  for (const record of records) {
    if (countCompanyBoards() >= MAX_COMPANY_BOARDS) {
      overLimit++
      continue
    }

    const result = db
      .insert(companyBoards)
      .values({
        id: randomUUID(),
        boardKey: record.boardKey,
        provider: record.provider,
        token: record.token,
        host: record.host,
        site: record.site,
        companyName: record.companyName,
        addedBy: record.addedBy,
        enabled: record.enabled,
        seedJobCount: normaliseSeedJobCount(record.seedJobCount),
        createdAt: record.createdAt
      })
      .onConflictDoNothing({ target: companyBoards.boardKey })
      .run()

    if (result.changes > 0) imported++
    else alreadyTracked++
  }

  return { imported, skipped: alreadyTracked + overLimit, alreadyTracked, overLimit }
}

import { randomUUID } from 'crypto'
import { and, asc, eq, or, sql, type SQL } from 'drizzle-orm'
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
    lastError: row.lastError,
    createdAt: row.createdAt
  }
}

export interface AddCompanyBoardInput extends AtsBoardDescriptor {
  boardKey: string
  companyName: string
  addedBy: 'user' | 'agent'
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

export function countCompanyBoards(): number {
  return getDb().select({ count: sql<number>`count(*)` }).from(companyBoards).get()?.count ?? 0
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
      addedBy: input.addedBy
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
 * Records what the last fetch of a board actually did, so the UI can show a
 * board that has quietly stopped answering (a retired slug, a migration)
 * instead of it just contributing nothing to every search.
 *
 * `jobCount: 0` with no error is a real state and is stored as such — a live
 * board with nothing open right now.
 */
export function recordCompanyBoardFetch(
  boardKey: string,
  outcome: { jobCount: number; error?: string | null },
  now: string = new Date().toISOString()
): void {
  getDb()
    .update(companyBoards)
    .set({
      lastCheckedAt: now,
      lastJobCount: outcome.jobCount,
      lastError: outcome.error ?? null
    })
    .where(eq(companyBoards.boardKey, boardKey))
    .run()
}

/** Unpaginated read for a one-shot export, mirroring `listAllExclusions`. */
export function listAllCompanyBoards(): CompanyBoardRecord[] {
  return getDb().select().from(companyBoards).orderBy(asc(companyBoards.createdAt)).all().map(toRecord)
}

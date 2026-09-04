import type { AppError } from './errorCodes'

/**
 * A company's own ATS job board, tracked as a search source.
 *
 * None of these providers has a cross-company search endpoint — every call is
 * scoped to one company's board — so "searching Greenhouse" means fetching the
 * boards of companies we've been told about and filtering locally. This type
 * is what identifies one such board.
 */
export type AtsProvider = 'greenhouse' | 'lever' | 'ashby' | 'workday'

export const ATS_PROVIDERS: AtsProvider[] = ['greenhouse', 'lever', 'ashby', 'workday']

export function isAtsProvider(value: unknown): value is AtsProvider {
  return typeof value === 'string' && (ATS_PROVIDERS as string[]).includes(value)
}

/**
 * Everything needed to address one board.
 *
 * Greenhouse/Lever/Ashby are a single slug on a fixed host. Workday is not:
 * its list endpoint is `POST https://{host}/wday/cxs/{tenant}/{site}/jobs`, so
 * it needs the data-centre host and the career-site id alongside the tenant
 * (which is what `token` holds for it). Those two are null for the other three.
 */
export interface AtsBoardDescriptor {
  provider: AtsProvider
  /** Board slug — for Workday, the tenant. */
  token: string
  /** Workday only: `acme.wd5.myworkdayjobs.com`. */
  host: string | null
  /** Workday only: the career-site id, e.g. `AcmeExternalCareerSite`. Case-sensitive. */
  site: string | null
}

export interface CompanyBoardRecord extends AtsBoardDescriptor {
  id: string
  /** Stable identity of the board: `provider:token[:host:site]`, lowercased. */
  boardKey: string
  /** What to show and to file postings under; falls back to the token. */
  companyName: string
  addedBy: 'user' | 'agent'
  enabled: boolean
  /** Last time a search actually fetched this board (null until the first one). */
  lastCheckedAt: string | null
  /** Postings returned by that fetch — 0 is a real answer (a live board with nothing open). */
  lastJobCount: number | null
  /**
   * Open roles the feed this board was imported from claimed it holds, or
   * null when it came from anywhere else. Hearsay, not a measurement: it only
   * orders boards nothing has fetched yet, and `lastJobCount` overrides it
   * the moment there is one.
   */
  seedJobCount: number | null
  /** Untranslated diagnostic from the last failed fetch, or null if it succeeded. */
  lastError: string | null
  createdAt: string
}

export interface ListCompanyBoardsQuery {
  limit?: number
  offset?: number
  search?: string
}

export interface ListCompanyBoardsResult {
  boards: CompanyBoardRecord[]
  total: number
}

/** One (provider, slug) pair that answered during resolution, with what it returned. */
export interface BoardProbeCandidate {
  provider: AtsProvider
  token: string
  /** Postings on that board. 0 means the slug exists but nothing is open — not that the slug is wrong. */
  jobCount: number
}

/**
 * What one manual "fetch this board now" came back with.
 *
 * `not_found` is kept apart from `error`: a 404 means the slug itself is
 * wrong (the company moved ATS, or the board was retired), which is a
 * different thing to fix than a provider being unreachable, and `ok` with
 * `jobCount: 0` is a third answer again — a live board with nothing open.
 */
export interface BoardFetchOutcome {
  id: string
  companyName: string
  provider: AtsProvider
  status: 'ok' | 'not_found' | 'error'
  jobCount: number
  /** Untranslated diagnostic when the fetch failed; null when the board answered. */
  message: string | null
}

export type FetchCompanyBoardsResult = { ok: true; results: BoardFetchOutcome[] } | { ok: false; error: AppError }

/**
 * One board's fetch, pushed the moment it lands rather than held until the
 * batch it belongs to finishes.
 *
 * It carries the stored row, not just the outcome, so the list can replace
 * that one row without re-reading the whole watchlist per board — and the row
 * it shows is the row that was written, rather than the renderer's own
 * reconstruction of it. `board` is null only if it was removed mid-fetch.
 */
export interface BoardFetchedPayload {
  result: BoardFetchOutcome
  board: CompanyBoardRecord | null
}

export type ResolveBoardOutcome =
  | {
      status: 'resolved'
      descriptor: AtsBoardDescriptor
      companyName: string
      jobCount: number
      /**
       * False when the board was taken from an explicit URL/token that we
       * could not reach to confirm (offline, provider outage) — the caller
       * decides whether to store it anyway.
       */
      verified: boolean
      /** More than one provider answered with postings — an ATS migration can leave both boards live. */
      ambiguous: boolean
      candidates: BoardProbeCandidate[]
    }
  | { status: 'not_found'; triedTokens: string[] }
  | { status: 'error'; message: string }

/**
 * Bulk-importing a watchlist from a CSV.
 *
 * There is no agreed schema for a list of ATS boards — the published feeds
 * use `provider,token,open_postings,board_url,api_url`, a hand-kept
 * spreadsheet uses whatever its author typed — so the file's columns are
 * mapped onto these fields by the person importing rather than matched by
 * name. `suggestBoardCsvMapping` guesses the mapping from the header row;
 * the guess is a starting point the user can correct, never the contract.
 */
export const BOARD_CSV_FIELDS = ['company', 'provider', 'token', 'openPostings', 'boardUrl', 'apiUrl'] as const

export type BoardCsvField = (typeof BOARD_CSV_FIELDS)[number]

/** Which column of the file feeds each field, by index; null when the file has no such column. */
export type BoardCsvMapping = Record<BoardCsvField, number | null>

export function emptyBoardCsvMapping(): BoardCsvMapping {
  return { company: null, provider: null, token: null, openPostings: null, boardUrl: null, apiUrl: null }
}

/** A picked file, parsed far enough to map its columns. */
export interface BoardCsvFile {
  filePath: string
  fileName: string
  headers: string[]
  /** The first rows, shown under the mapping controls so a wrong column is visible immediately. */
  sampleRows: string[][]
  rowCount: number
  /** True when the file held more rows than the parser reads and the tail was dropped. */
  truncated: boolean
  suggestedMapping: BoardCsvMapping
}

export interface BoardCsvImportOptions {
  /**
   * Boards with fewer open roles than this are left out. A slug that answers
   * with an empty board is the normal shape of a company that has moved ATS
   * provider and left the old board live, so importing a large feed without a
   * floor fills the watchlist with boards that will never return a posting.
   * Ignored when no count column is mapped, since then nothing is known.
   */
  minOpenPostings: number
  /** Ceiling on this one import, on top of `MAX_COMPANY_BOARDS`. */
  maxImport: number
}

/** One board an import would add, for the preview. */
export interface BoardCsvPreviewRow {
  companyName: string
  provider: AtsProvider
  token: string
  site: string | null
  openPostings: number | null
}

/**
 * What a mapping would do to the file, computed without writing anything.
 *
 * Every row of the file lands in exactly one of these buckets, so the numbers
 * add up to `totalRows` and a surprising `willImport` can be explained by the
 * user rather than just accepted.
 */
export interface BoardCsvPlan {
  totalRows: number
  /** No board could be derived: no provider/token pair, no recognised URL, or a Workday row without its career site. */
  unusable: number
  /** Below `minOpenPostings`. */
  belowThreshold: number
  /** Named a board an earlier row in the same file already named. */
  duplicates: number
  /** Named a board already on the watchlist. */
  alreadyTracked: number
  /** Fit neither `maxImport` nor the watchlist's remaining capacity. */
  overLimit: number
  willImport: number
  /** The first few boards that would be added, in the order they'd be added. */
  sample: BoardCsvPreviewRow[]
  capacity: BoardCsvCapacity
}

export interface BoardCsvCapacity {
  tracked: number
  limit: number
  remaining: number
}

export interface BoardCsvImportSummary {
  totalRows: number
  imported: number
  /** Rows whose board was already tracked by the time the write ran. */
  alreadyTracked: number
  /** Everything else the file held: unusable, below threshold, duplicate, or over the limit. */
  skipped: number
}

export type BoardCsvPickResult =
  | { ok: true; file: BoardCsvFile; capacity: BoardCsvCapacity }
  | { ok: false; canceled: true }
  | { ok: false; error: AppError }

export type BoardCsvPlanResult =
  | { ok: true; plan: BoardCsvPlan }
  | { ok: false; error: AppError }

export type BoardCsvImportResult =
  | { ok: true; summary: BoardCsvImportSummary }
  | { ok: false; error: AppError }

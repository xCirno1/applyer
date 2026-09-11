import { getSettings } from './settings'

const settings = getSettings()

export const BUILTIN_FAILURE_TAGS = settings.dangerousBuiltinFailureTags
export const BUILTIN_FAILURE_TAG_IDS = BUILTIN_FAILURE_TAGS.map((tag) => tag.id)

export const LIST_JOBS_MAX_LIMIT = settings.dangerousListJobsMaxLimit
export const LIST_JOBS_DEFAULT_LIMIT = settings.listJobsDefaultLimit
export const SEARCH_JOBS_MAX_LIMIT = settings.dangerousSearchJobsMaxLimit
export const SEARCH_JOBS_DEFAULT_LIMIT = settings.searchJobsDefaultLimit

export const LIST_EXCLUSIONS_MAX_LIMIT = settings.dangerousListExclusionsMaxLimit
export const LIST_EXCLUSIONS_DEFAULT_LIMIT = settings.listExclusionsDefaultLimit

export const LIST_INDEXED_JOBS_MAX_LIMIT = settings.dangerousListIndexedJobsMaxLimit
export const LIST_INDEXED_JOBS_DEFAULT_LIMIT = settings.listIndexedJobsDefaultLimit

/** Retention options offered on the Indexed Jobs page, in days; `'unlimited'` disables pruning entirely. */
export const INDEXED_JOBS_RETENTION_OPTIONS = settings.indexedJobsRetentionOptions
export const INDEXED_JOBS_RETENTION_DEFAULT_DAYS = settings.indexedJobsRetentionDefaultDays

export const JOB_DETAILS_CACHE_TTL_MS = settings.jobDetailsCacheTtlMs

/**
 * Stamped onto every cached job-details payload, and required to match on
 * read. Bump it whenever the scrapers change what they put in a payload, so
 * entries produced by the previous build are refetched instead of served
 * from cache for up to another TTL.
 *
 * 1: descriptionText has HTML entities decoded (`&` rather than `&amp;`).
 */
export const JOB_DETAILS_CACHE_PAYLOAD_VERSION = settings.dangerousJobDetailsCachePayloadVersion

export const MAX_DOCUMENT_SIZE_BYTES = settings.dangerousMaxDocumentSizeBytes

/**
 * Ceiling on tracked ATS boards. Every board is one HTTP request per search,
 * so this is what stops an agent looping on `add_company_board` from turning
 * a single `search_jobs` call into a thousand outbound requests.
 */
export const MAX_COMPANY_BOARDS = settings.dangerousMaxCompanyBoards

/**
 * The watchlist is bounded by `MAX_COMPANY_BOARDS`, so "every board" is a
 * legitimate single read here in a way it never is for jobs or indexed jobs:
 * the whole table is a few hundred rows of a few short strings each. That is
 * what lets the Company Boards panel sort, filter and paginate over the real
 * list rather than over whichever pages it happened to have fetched. The
 * agent's `list_company_boards` tool caps itself at 50 regardless (see
 * `mcp-server/schemas.ts`), since nothing there needs the whole list at once.
 */
export const LIST_COMPANY_BOARDS_MAX_LIMIT = MAX_COMPANY_BOARDS
export const LIST_COMPANY_BOARDS_DEFAULT_LIMIT = settings.listCompanyBoardsDefaultLimit

/**
 * Bulk import of a watchlist from a CSV.
 *
 * The published ATS feeds are on the order of 10k rows and a couple of
 * megabytes, so both ceilings are generous rather than tight — they exist to
 * stop a wrong file (a database dump, a log) from being parsed into memory in
 * full, not to bound a legitimate one.
 */
export const MAX_BOARD_CSV_BYTES = settings.dangerousMaxBoardCsvBytes
export const MAX_BOARD_CSV_ROWS = settings.dangerousMaxBoardCsvRows
/** Rows shown under the column-mapping controls, and boards shown in the plan preview. */
export const BOARD_CSV_PREVIEW_ROWS = settings.boardCsvPreviewRows

/**
 * Boards one manual "fetch now" may cover.
 *
 * A refresh is the same one-request-per-board cost as a search, so it needs a
 * ceiling too; it is higher than the per-search one because a person pressed
 * a button for these specific boards rather than an agent sweeping the list.
 */
export const MAX_MANUAL_BOARD_FETCH = settings.dangerousMaxManualBoardFetch

/**
 * Postings a manual fetch asks for. Only Workday reads it (the other three
 * serve a whole board in one response), and its adapter pages in 20s, so this
 * is three pages — enough to tell a busy board from an empty one, which is
 * all this reading is for.
 */
export const MANUAL_BOARD_FETCH_LIMIT = settings.dangerousManualBoardFetchLimit

/** Boards fetched in one `search_jobs` call — the rest are skipped with a warning. */
export const MAX_ATS_BOARDS_PER_SEARCH = settings.dangerousMaxAtsBoardsPerSearch

/**
 * Share of that budget reserved for the boards nothing has looked at in
 * longest, rather than for the boards known to hold the most roles.
 *
 * Without it, ranking by size is self-fulfilling: a board that has never been
 * fetched has no known size, so it would never be picked, so it would never
 * get one — and a board that happened to be empty once would never be looked
 * at again. A fifth of the budget is enough to measure a freshly imported
 * watchlist within a few searches while leaving most of every search spent
 * where the roles actually are.
 */
export const ATS_SWEEP_ROTATION_SHARE = settings.atsSweepRotationShare

/** In-flight board fetches. Small on purpose: these are a handful of hosts, not a crawl. */
export const ATS_FETCH_CONCURRENCY = settings.dangerousAtsFetchConcurrency

export const ATS_FETCH_TIMEOUT_MS = settings.atsFetchTimeoutMs

/**
 * How long a fetched board is reused across searches. Boards change on the
 * order of a day; an agent commonly runs several searches in a row, and
 * re-fetching a 500-posting board for each of them is pure waste.
 */
export const ATS_BOARD_CACHE_TTL_MS = settings.atsBoardCacheTtlMs
/** A 404 (wrong slug) is far more stable than a transient network failure, so it is held longer. */
export const ATS_BOARD_NOT_FOUND_CACHE_TTL_MS = settings.atsBoardNotFoundCacheTtlMs
export const ATS_BOARD_ERROR_CACHE_TTL_MS = settings.atsBoardErrorCacheTtlMs
/** Cached boards held in memory at once (LRU-evicted) — bounds memory on a large watchlist. */
export const ATS_BOARD_CACHE_MAX_ENTRIES = settings.dangerousAtsBoardCacheMaxEntries

/** Slug guesses derived from one company name/domain before probing stops. */
export const MAX_SLUG_CANDIDATES = settings.dangerousMaxSlugCandidates

/**
 * Probing is speculative — most of these requests are expected to 404 — and
 * it runs while someone waits on a dialog, so it is wider and less patient
 * than a search fetch.
 */
export const ATS_PROBE_CONCURRENCY = settings.dangerousAtsProbeConcurrency
export const ATS_PROBE_TIMEOUT_MS = settings.atsProbeTimeoutMs

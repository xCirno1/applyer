export const BUILTIN_FAILURE_TAG_IDS = [
  'captcha_verification',
  'login_required',
  'form_not_supported',
  'expired_listing',
  'duplicate',
  'other'
] as const

export const LIST_JOBS_MAX_LIMIT = 50
export const LIST_JOBS_DEFAULT_LIMIT = 20
export const SEARCH_JOBS_MAX_LIMIT = 50
export const SEARCH_JOBS_DEFAULT_LIMIT = 20

export const LIST_EXCLUSIONS_MAX_LIMIT = 50
export const LIST_EXCLUSIONS_DEFAULT_LIMIT = 20

export const LIST_INDEXED_JOBS_MAX_LIMIT = 50
export const LIST_INDEXED_JOBS_DEFAULT_LIMIT = 20

/** Retention options offered on the Indexed Jobs page, in days; `'unlimited'` disables pruning entirely. */
export const INDEXED_JOBS_RETENTION_OPTIONS = [7, 14, 30, 90, 'unlimited'] as const
export const INDEXED_JOBS_RETENTION_DEFAULT_DAYS = 30

export const JOB_DETAILS_CACHE_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Stamped onto every cached job-details payload, and required to match on
 * read. Bump it whenever the scrapers change what they put in a payload, so
 * entries produced by the previous build are refetched instead of served
 * from cache for up to another TTL.
 *
 * 1: descriptionText has HTML entities decoded (`&` rather than `&amp;`).
 */
export const JOB_DETAILS_CACHE_PAYLOAD_VERSION = 1

export const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024

export const LIST_COMPANY_BOARDS_MAX_LIMIT = 50
export const LIST_COMPANY_BOARDS_DEFAULT_LIMIT = 20

/**
 * Ceiling on tracked ATS boards. Every board is one HTTP request per search,
 * so this is what stops an agent looping on `add_company_board` from turning
 * a single `search_jobs` call into a thousand outbound requests.
 */
export const MAX_COMPANY_BOARDS = 200

/** Boards fetched in one `search_jobs` call — the rest are skipped with a warning. */
export const MAX_ATS_BOARDS_PER_SEARCH = 25

/** In-flight board fetches. Small on purpose: these are a handful of hosts, not a crawl. */
export const ATS_FETCH_CONCURRENCY = 4

export const ATS_FETCH_TIMEOUT_MS = 15000

/**
 * How long a fetched board is reused across searches. Boards change on the
 * order of a day; an agent commonly runs several searches in a row, and
 * re-fetching a 500-posting board for each of them is pure waste.
 */
export const ATS_BOARD_CACHE_TTL_MS = 15 * 60 * 1000
/** A 404 (wrong slug) is far more stable than a transient network failure, so it is held longer. */
export const ATS_BOARD_NOT_FOUND_CACHE_TTL_MS = 30 * 60 * 1000
export const ATS_BOARD_ERROR_CACHE_TTL_MS = 2 * 60 * 1000
/** Cached boards held in memory at once (LRU-evicted) — bounds memory on a large watchlist. */
export const ATS_BOARD_CACHE_MAX_ENTRIES = 60

/** Slug guesses derived from one company name/domain before probing stops. */
export const MAX_SLUG_CANDIDATES = 6

/**
 * Probing is speculative — most of these requests are expected to 404 — and
 * it runs while someone waits on a dialog, so it is wider and less patient
 * than a search fetch.
 */
export const ATS_PROBE_CONCURRENCY = 6
export const ATS_PROBE_TIMEOUT_MS = 8000

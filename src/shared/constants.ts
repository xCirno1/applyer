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

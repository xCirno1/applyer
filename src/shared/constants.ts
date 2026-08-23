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

export const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024

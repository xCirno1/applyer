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

export const JOB_DETAILS_CACHE_TTL_MS = 24 * 60 * 60 * 1000

export const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024

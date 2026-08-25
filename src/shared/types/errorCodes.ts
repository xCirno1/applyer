// Error identity crossing the IPC boundary.
//
// The main process has no locale context — it runs before the renderer picks
// a language, and its errors also reach electron-log and export bundles,
// where a translated sentence would be actively unhelpful when a user pastes
// it into a bug report. So handlers return a machine-readable code plus any
// interpolation params, and the renderer turns that into a sentence via the
// `errors` i18n namespace (see renderer/src/i18n/formatError.ts).
//
// Keys here must match the keys in i18n/locales/*/errors.json one-for-one;
// `formatError` is typed against that catalog, so `npm run typecheck:web`
// fails if a code is added here without a matching English string.

export type ErrorCode =
  | 'urlRequired'
  | 'invalidUrl'
  | 'invalidProfileData'
  | 'invalidUploadRequest'
  | 'invalidStorageMode'
  | 'invalidRetention'
  | 'invalidTable'
  | 'invalidJson'
  | 'invalidCommand'
  | 'invalidExport'
  | 'jobNotFound'
  | 'jobNotQueued'
  | 'illegalTransition'
  | 'taskNotWaiting'
  | 'captchaUnresolved'
  | 'keychainUnavailable'
  | 'commandTooLong'
  | 'unsupportedFileType'
  | 'fileTooLarge'
  | 'unexpected'

/** Values interpolated into the translated message (`{{max}}`, `{{message}}`, …). */
export type ErrorParams = Record<string, string | number>

export interface AppError {
  code: ErrorCode
  params?: ErrorParams
}

export function appError(code: ErrorCode, params?: ErrorParams): AppError {
  return params ? { code, params } : { code }
}

/**
 * Wrap a thrown value that has no code of its own — a filesystem failure, a
 * better-sqlite3 error, an unexpected throw. The raw message is carried as a
 * param rather than being dropped: it's untranslatable, but it's the only
 * diagnostic the user can report, so `errors.unexpected` renders it inside a
 * translated frame.
 */
export function unexpectedError(err: unknown): AppError {
  return appError('unexpected', { message: err instanceof Error ? err.message : String(err) })
}

/** Runtime guard for the renderer — IPC payloads are never trusted as-is. */
export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'string'
  )
}

// Turns the `{ code, params }` shape the main process returns (see
// shared/types/errorCodes.ts) into a sentence in the active language.
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { isAppError, type ErrorCode } from '@shared/types/errorCodes'
import enErrors from './locales/en/errors.json'

/**
 * Compile-time proof that every `ErrorCode` has an English string. Adding a
 * code to the union without adding the key here is a `typecheck:web`
 * failure, not a raw key id leaking into a toast at runtime.
 *
 * (Extra keys in the catalog are allowed — this only asserts coverage.)
 */
export const ERROR_MESSAGE_COVERAGE: Record<ErrorCode, string> = enErrors

const KNOWN_CODES = new Set(Object.keys(enErrors))

/**
 * Format an IPC error for display.
 *
 * Everything here is defensive: an IPC payload is data from another process,
 * so a malformed error — a bare string, `undefined`, an object with a code
 * this build doesn't know — has to produce a sensible sentence rather than
 * rendering `[object Object]` or a raw key id into a toast.
 */
export function useErrorMessage(): (error: unknown) => string {
  const { t } = useTranslation('errors')

  return useCallback(
    (error: unknown): string => {
      if (!isAppError(error)) {
        // A plain string still happens on paths that haven't been converted
        // (or from a future main-process version); show it as-is rather than
        // swallowing the only diagnostic the user has.
        const message = typeof error === 'string' ? error : String(error ?? '')
        return message ? t('unexpected', { message }) : t('unexpectedNoDetail')
      }

      if (!KNOWN_CODES.has(error.code)) {
        // A code this renderer doesn't have a string for — surface the code
        // itself so a bug report still says something actionable.
        return t('unexpected', { message: error.code })
      }

      return t(error.code, { ...error.params })
    },
    [t]
  )
}

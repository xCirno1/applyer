import { isEncryptionAvailable, readSecureField, writeSecureField } from '../db/encryption'
import {
  clearOpenRouterApiKey,
  getOpenRouterApiKeyRaw,
  setOpenRouterApiKeyRaw
} from '../db/repositories/settingsRepository'
import { appLogger } from '../logger'

/**
 * The OpenRouter API key is deliberately *independent* of the user's data
 * storage-mode setting (Settings > Storage: encrypted vs plaintext). That
 * setting is about the user's own job data, and the user is allowed to
 * decide plaintext is fine for it on their own machine; an API credential
 * that can spend real money on someone else's account is not that kind of
 * data, so it is always run through the OS keychain (`safeStorage`) when
 * one exists, no matter what storage mode is active.
 *
 * The one exception is a machine with no OS keychain at all (Electron
 * reports `safeStorage.isEncryptionAvailable() === false`, or Linux's
 * `basic_text` fallback, which `isEncryptionAvailable()` in `db/encryption`
 * already treats as "no real encryption"). There, connecting is still
 * possible, but only after the renderer shows an explicit warning and the
 * user opts in (`allowPlaintext`); this module fails closed otherwise, the
 * same shape as `writeSecureField` itself.
 *
 * The version-tagged `enc:v1:` prefix that `db/encryption.ts` writes is
 * reused here (not re-exported from there; it is a format marker, not an
 * API) purely to answer "was this stored encrypted or in the clear",
 * something callers need for the "stored as plaintext" warning in
 * Settings, without decrypting anything to find out.
 */

const ENCRYPTED_PREFIX = 'enc:v1:'

export class OpenRouterKeychainUnavailableError extends Error {
  constructor() {
    super('No secure OS keychain is available to store the OpenRouter API key, and plaintext storage was not allowed.')
    this.name = 'OpenRouterKeychainUnavailableError'
  }
}

export interface StoreOpenRouterKeyOptions {
  /** Only honoured when no OS keychain is available. */
  allowPlaintext?: boolean
}

/**
 * Persists a freshly exchanged API key. Throws `OpenRouterKeychainUnavailableError`
 * when there is no keychain and the caller did not explicitly allow
 * plaintext; the IPC layer maps that to `openrouterKeychainUnavailable`.
 */
export function storeOpenRouterKey(key: string, options: StoreOpenRouterKeyOptions = {}): void {
  const mode = isEncryptionAvailable() ? 'encrypted' : options.allowPlaintext ? 'plaintext' : null
  if (mode === null) {
    throw new OpenRouterKeychainUnavailableError()
  }
  const stored = writeSecureField(key, mode)
  if (stored === null) {
    // writeSecureField only returns null for a null input, which never
    // happens here; guarded for completeness rather than left as an
    // implicit non-null assertion.
    throw new Error('Could not encode the OpenRouter API key for storage.')
  }
  setOpenRouterApiKeyRaw(stored)
}

export interface StoredOpenRouterKey {
  key: string
  /** True when the key is sitting in the database unencrypted (no keychain was available when it was stored). */
  storedPlaintext: boolean
}

/**
 * Reads back the stored key, or null if there is none. A value that was
 * encrypted but can no longer be decrypted (keychain became unavailable
 * since it was written: a locked keyring, a headless session, a moved
 * profile) is treated the same as "no key": the renderer shows "not
 * connected" and lets the user reconnect, rather than the whole app
 * throwing on every Settings-page render.
 */
export function readOpenRouterKey(): StoredOpenRouterKey | null {
  const raw = getOpenRouterApiKeyRaw()
  if (raw === null) return null
  const storedPlaintext = !raw.startsWith(ENCRYPTED_PREFIX)
  try {
    const key = readSecureField(raw)
    if (key === null) return null
    return { key, storedPlaintext }
  } catch (err) {
    appLogger.warn(
      `OpenRouter API key is stored encrypted but could not be decrypted right now (keychain unavailable?): ${String(err)}`
    )
    return null
  }
}

export function clearOpenRouterKey(): void {
  clearOpenRouterApiKey()
}

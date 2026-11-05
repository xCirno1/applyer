import { readSecureField, writeSecureField } from '../db/encryption'
import {
  clearCustomSystemPrompt,
  getCustomSystemPromptRaw,
  getStorageMode,
  setCustomSystemPromptRaw
} from '../db/repositories/settingsRepository'
import { parseCustomSystemPrompt } from '@shared/types/customSystemPrompt'
import type { StorageMode } from '@shared/types/profile'
import { appLogger } from '../logger'

/**
 * Persistence for the user's custom agent instructions. Unlike the other
 * settings rows, this one is free text the user wrote, possibly naming
 * employers, salary floors or personal circumstances, so it is user data in
 * the sense Settings > Storage means: it is run through `writeSecureField`
 * for the active storage mode (failing closed to encrypted when no mode was
 * ever chosen, same as `profileRepository`/`chatRepository`) and rewritten
 * by `rewriteCustomSystemPromptStorageMode` when that mode changes.
 */

function currentMode(): StorageMode {
  return getStorageMode() ?? 'encrypted'
}

/**
 * The stored instructions, or `''` when there are none. Throws when the row
 * is encrypted and the keychain cannot decrypt it right now: the Settings
 * editor needs to tell that apart from "empty" so a save does not silently
 * replace text the user cannot currently see. Prompt builders use
 * `readCustomSystemPromptForAgent` instead.
 */
export function getCustomSystemPrompt(): string {
  const raw = getCustomSystemPromptRaw()
  if (raw === null) return ''
  const decoded = readSecureField(raw) ?? ''
  // Re-validated on read: a row edited by hand or written by a build with a
  // different cap must not reach a prompt unchecked.
  const parsed = parseCustomSystemPrompt(decoded)
  if (!parsed.ok) {
    appLogger.warn(`Stored custom system prompt is invalid (${parsed.reason}); ignoring it`)
    return ''
  }
  return parsed.value
}

/**
 * Validates, normalizes and stores the instructions; an empty result clears
 * the row. Returns the stored text so the caller can show exactly what was
 * saved, or throws a `CustomSystemPromptError` naming why it was refused.
 */
export function saveCustomSystemPrompt(value: unknown): string {
  const parsed = parseCustomSystemPrompt(value)
  if (!parsed.ok) throw new CustomSystemPromptError(parsed.reason)
  if (parsed.value === '') {
    clearCustomSystemPrompt()
    return ''
  }
  const stored = writeSecureField(parsed.value, currentMode())
  if (stored === null) throw new Error('Could not encode the custom system prompt for storage.')
  setCustomSystemPromptRaw(stored)
  return parsed.value
}

export class CustomSystemPromptError extends Error {
  constructor(readonly reason: 'notString' | 'tooLong') {
    super(reason === 'tooLong' ? 'The custom system prompt is too long.' : 'The custom system prompt must be text.')
    this.name = 'CustomSystemPromptError'
  }
}

/**
 * The instructions for a prompt builder: never throws, since a locked
 * keyring or a corrupt row must not stop the agent from getting its
 * built-in instructions. A failure is logged and treated as "no custom
 * instructions" for that build.
 */
export function readCustomSystemPromptForAgent(): string {
  try {
    return getCustomSystemPrompt()
  } catch (err) {
    appLogger.warn(`Custom system prompt could not be read; continuing without it: ${String(err)}`)
    return ''
  }
}

/** Re-encodes the stored row for a new storage mode; called by the storage-mode change alongside the other user-data rewrites. */
export function rewriteCustomSystemPromptStorageMode(mode: StorageMode): void {
  const raw = getCustomSystemPromptRaw()
  if (raw === null) return
  const decoded = readSecureField(raw)
  if (decoded === null || decoded === '') {
    clearCustomSystemPrompt()
    return
  }
  const stored = writeSecureField(decoded, mode)
  if (stored !== null) setCustomSystemPromptRaw(stored)
}

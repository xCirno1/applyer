import { app } from 'electron'
import { accessSync, constants, existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { isAbsolute, join } from 'path'
import type { StorageLocationPointer } from '@shared/types/storageLocation'

const POINTER_FILENAME = 'storage-location.json'
const DEFAULT_POINTER: StorageLocationPointer = { schemaVersion: 1, customRoot: null }

/**
 * ALWAYS the fixed OS-default userData dir — never itself relocated. This is
 * what makes the active location discoverable before applyer.db (which would
 * otherwise hold this setting, per the rest of appSettings) can even be opened.
 */
export function pointerFilePath(): string {
  return join(defaultStorageRoot(), POINTER_FILENAME)
}

/** The fixed OS-default userData dir — never itself relocated. */
export function defaultStorageRoot(): string {
  return app.getPath('userData')
}

function isValidPointer(value: unknown): value is StorageLocationPointer {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (v.schemaVersion !== 1) return false
  if (v.customRoot === null) return true
  return typeof v.customRoot === 'string' && v.customRoot.trim() !== '' && isAbsolute(v.customRoot)
}

export function readStorageLocationPointer(): {
  pointer: StorageLocationPointer
  fallbackReason: string | null
} {
  const path = pointerFilePath()
  if (!existsSync(path)) {
    return { pointer: DEFAULT_POINTER, fallbackReason: null }
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf-8'))
    if (!isValidPointer(raw)) {
      return { pointer: DEFAULT_POINTER, fallbackReason: 'The saved storage location file was invalid.' }
    }
    return { pointer: raw, fallbackReason: null }
  } catch {
    return { pointer: DEFAULT_POINTER, fallbackReason: 'The saved storage location file could not be read.' }
  }
}

/** Atomic: write to a temp file then rename over the real one. */
export function writeStorageLocationPointer(pointer: StorageLocationPointer): void {
  const path = pointerFilePath()
  const tempPath = `${path}.tmp-${process.pid}`
  writeFileSync(tempPath, JSON.stringify(pointer), 'utf-8')
  renameSync(tempPath, path)
}

/**
 * A pointer only ever names a customRoot after a migration successfully
 * created applyer.db there — so its absence is always anomalous, not a
 * legitimate empty-but-valid location. Checking directory access alone isn't
 * enough: an unmounted-but-still-writable mount point (common on Linux,
 * where the mountpoint directory persists on the local filesystem even when
 * nothing is mounted there) would otherwise pass, and initDatabase would
 * silently create a brand-new, blank database there — the user's real data
 * still sits on the unmounted drive, with no warning shown. Exported so the
 * "Retry" recovery action (storageLocation/recovery.ts) can reuse the exact
 * same check used at boot.
 */
export function isCustomRootAvailable(customRoot: string): boolean {
  try {
    accessSync(customRoot, constants.R_OK | constants.W_OK)
    return existsSync(join(customRoot, 'applyer.db'))
  } catch {
    return false
  }
}

let activeRoot: string | null = null

/** Lightweight, dismissible — set only when there's nothing concrete to retry (a corrupt/unreadable pointer file means we don't even know what the custom root was). One-shot: consumed by the first Settings-page status read. */
let startupFallbackWarning: string | null = null

export interface StorageRecoveryState {
  needed: boolean
  /** Human-readable explanation, set together with `needed`. */
  reason: string | null
  /** The pointer's customRoot that couldn't be used, so the recovery UI can display/retry it. */
  unavailableCustomRoot: string | null
}

const NO_RECOVERY_NEEDED: StorageRecoveryState = { needed: false, reason: null, unavailableCustomRoot: null }

/**
 * Stable — unlike `startupFallbackWarning`, this is NOT consumed on first
 * read. It must stay `needed: true` across as many status reads as it takes
 * for the user to actually resolve it (retry, or explicitly choose the
 * default), since the whole point is blocking the app until they do —
 * missing a one-shot toast must never be how this gets silently bypassed.
 */
let recoveryState: StorageRecoveryState = NO_RECOVERY_NEEDED

export function getStorageRecoveryState(): StorageRecoveryState {
  return recoveryState
}

/** Called by the "Retry"/"Use default" recovery actions once resolved (storageLocation/recovery.ts) — never called directly from here. */
export function clearStorageRecoveryState(): void {
  recoveryState = NO_RECOVERY_NEEDED
}

/** Call once, first thing in bootstrap.ts's app.whenReady() callback, before initDatabase(). Never throws. */
export function resolveActiveStorageRoot(): void {
  const defaultRoot = defaultStorageRoot()
  startupFallbackWarning = null
  recoveryState = NO_RECOVERY_NEEDED
  const { pointer, fallbackReason } = readStorageLocationPointer()

  if (fallbackReason) {
    // Nothing concrete to retry — we don't even know what the custom root
    // was, so this stays a lightweight, dismissible toast rather than a
    // full block (unlike the branch below, where the user CAN retry/reconnect).
    activeRoot = defaultRoot
    startupFallbackWarning = `${fallbackReason} Using the default storage location instead.`
    return
  }

  if (!pointer.customRoot) {
    // Intentionally using the default — the normal case, not a fallback.
    activeRoot = defaultRoot
    return
  }

  if (isCustomRootAvailable(pointer.customRoot)) {
    activeRoot = pointer.customRoot
    return
  }

  activeRoot = defaultRoot
  recoveryState = {
    needed: true,
    reason: `Your custom storage location ("${pointer.customRoot}") is no longer available (it may have been unplugged, unmounted, or removed).`,
    unavailableCustomRoot: pointer.customRoot
  }
}

export function activeStorageRoot(): string {
  // Defensive fallback for any caller that somehow runs before resolution
  // (e.g. a future refactor, or a test) — never returns null.
  return activeRoot ?? defaultStorageRoot()
}

/** Migration-only setter — flips every location-aware path helper immediately. */
export function setActiveStorageRoot(root: string): void {
  activeRoot = root
}

export function consumeStartupFallbackWarning(): string | null {
  const warning = startupFallbackWarning
  startupFallbackWarning = null
  return warning
}

import { app } from 'electron'
import { accessSync, constants, existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { isAbsolute, join } from 'path'
import Database from 'better-sqlite3'
import type { StorageLocationPointer } from '@shared/types/storageLocation'
import { appError, type AppError } from '@shared/types/errorCodes'

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
  fallbackReason: AppError | null
} {
  const path = pointerFilePath()
  if (!existsSync(path)) {
    return { pointer: DEFAULT_POINTER, fallbackReason: null }
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf-8'))
    if (!isValidPointer(raw)) {
      return { pointer: DEFAULT_POINTER, fallbackReason: appError('pointerInvalid') }
    }
    return { pointer: raw, fallbackReason: null }
  } catch {
    return { pointer: DEFAULT_POINTER, fallbackReason: appError('pointerUnreadable') }
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
    const databasePath = join(customRoot, 'applyer.db')
    if (!existsSync(databasePath)) return false

    // Identity check only: never migrate or otherwise modify a database just
    // because a folder happened to contain a file named applyer.db. Every
    // Applyer database, including the oldest supported schema, has these core
    // tables plus Drizzle's migration ledger.
    const sqlite = new Database(databasePath, { readonly: true, fileMustExist: true })
    try {
      const integrity = sqlite.pragma('quick_check') as { quick_check: string }[]
      if (integrity[0]?.quick_check !== 'ok') return false
      const rows = sqlite
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name IN
             ('__drizzle_migrations', 'activity_log', 'app_settings', 'documents', 'jobs', 'profile')`
        )
        .all() as { name: string }[]
      const names = new Set(rows.map((row) => row.name))
      return ['__drizzle_migrations', 'activity_log', 'app_settings', 'documents', 'jobs', 'profile'].every(
        (name) => names.has(name)
      )
    } finally {
      sqlite.close()
    }
  } catch {
    return false
  }
}

let activeRoot: string | null = null
let activeRootRequiresExisting = false

/** Lightweight, dismissible — set only when there's nothing concrete to retry (a corrupt/unreadable pointer file means we don't even know what the custom root was). One-shot: consumed by the first Settings-page status read. */
let startupFallbackWarning: AppError | null = null

export interface StorageRecoveryState {
  needed: boolean
  /** Translatable explanation, set together with `needed`. */
  reason: AppError | null
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
  activeRootRequiresExisting = false
  const { pointer, fallbackReason } = readStorageLocationPointer()

  if (fallbackReason) {
    // Nothing concrete to retry — we don't even know what the custom root
    // was, so this stays a lightweight, dismissible toast rather than a
    // full block (unlike the branch below, where the user CAN retry/reconnect).
    activeRoot = defaultRoot
    // Passed through as-is: both pointer-failure codes are self-contained
    // sentences that already say the default location is being used, so
    // translators control the whole message rather than a concatenation.
    startupFallbackWarning = fallbackReason
    return
  }

  if (!pointer.customRoot) {
    // Intentionally using the default — the normal case, not a fallback.
    activeRoot = defaultRoot
    return
  }

  if (isCustomRootAvailable(pointer.customRoot)) {
    activeRoot = pointer.customRoot
    activeRootRequiresExisting = true
    return
  }

  activeRoot = defaultRoot
  recoveryState = {
    needed: true,
    reason: appError('recoveryUnavailable', { root: pointer.customRoot }),
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
  activeRootRequiresExisting = root !== defaultStorageRoot()
}

/** True only when startup selected a configured custom root; it must never be silently created. */
export function activeStorageRootRequiresExistingDatabase(): boolean {
  return activeRootRequiresExisting
}

/**
 * Converts a custom-root open race into the same explicit recovery state as
 * an unavailable root discovered during the earlier pointer check.
 */
export function fallbackToDefaultStorageAfterOpenFailure(reason: string): boolean {
  if (!activeRootRequiresExisting || !activeRoot) return false
  const unavailableCustomRoot = activeRoot
  activeRoot = defaultStorageRoot()
  activeRootRequiresExisting = false
  recoveryState = {
    needed: true,
    reason: appError('recoveryOpenFailed', { root: unavailableCustomRoot, message: reason }),
    unavailableCustomRoot
  }
  return true
}

export function consumeStartupFallbackWarning(): AppError | null {
  const warning = startupFallbackWarning
  startupFallbackWarning = null
  return warning
}

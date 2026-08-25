import { realpathSync } from 'fs'
import { isAbsolute, join, resolve } from 'path'
import { closeDatabase, openDatabaseAt, dbPath, getDb, seedFailureTags } from '../db'
import {
  activeStorageRoot,
  isCustomRootAvailable,
  getStorageRecoveryState,
  clearStorageRecoveryState,
  writeStorageLocationPointer,
  setActiveStorageRoot,
  defaultStorageRoot
} from '../config/storageLocation'
import { logActivity } from '../db/repositories/activityLogRepository'
import { pruneIndexedJobs } from '../db/repositories/indexedJobsRepository'
import { reconcileOrphanedBlockedJobs } from '../jobActions'
import { appLogger } from '../logger'
import { withStorageWriteLock } from '../storageWriteLock'
import type { StorageLocationMigrationResult } from '@shared/types/storageLocation'

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/** Startup's database-dependent maintenance, reused whenever the live connection changes mid-session. */
function runDatabaseStartupMaintenance(): void {
  seedFailureTags(getDb())
  reconcileOrphanedBlockedJobs()
  pruneIndexedJobs()
}

function logResolutionBestEffort(message: string, meta: Record<string, unknown>): void {
  try {
    logActivity('info', message, meta)
  } catch (err) {
    appLogger.warn(`Could not record storage-location recovery activity: ${errorMessage(err)}`)
  }
}

/**
 * Opens an existing Applyer root and treats the database connection, startup
 * maintenance, optional pointer write, and active-root flip as one commit.
 * The previous connection remains the authoritative fallback until every
 * step succeeds.
 */
function switchToExistingRoot(root: string, persistPointer: boolean): StorageLocationMigrationResult {
  if (!isAbsolute(root) || root.trim() === '') {
    return { ok: false, error: 'That is not a valid folder path.' }
  }
  if (!isCustomRootAvailable(root)) {
    return { ok: false, error: `No Applyer database found at "${root}".` }
  }

  const targetRoot = canonicalPath(root)
  const targetDbPath = join(targetRoot, 'applyer.db')
  const previousRoot = activeStorageRoot()
  const previousDbPath = dbPath()

  closeDatabase()
  try {
    openDatabaseAt(targetDbPath, { runMigrations: true })
    runDatabaseStartupMaintenance()

    if (persistPointer) {
      const isDefault = targetRoot === canonicalPath(defaultStorageRoot())
      writeStorageLocationPointer({ schemaVersion: 1, customRoot: isDefault ? null : targetRoot })
    }
    setActiveStorageRoot(targetRoot)
  } catch (err) {
    try {
      closeDatabase()
      openDatabaseAt(previousDbPath, { runMigrations: false })
      setActiveStorageRoot(previousRoot)
    } catch (reopenErr) {
      appLogger.error(
        `Failed to reopen the previous database after a failed storage-location connection: ${errorMessage(reopenErr)}`
      )
    }
    return { ok: false, error: `Could not open the database at "${root}": ${errorMessage(err)}` }
  }

  return { ok: true }
}

/**
 * The "Retry" recovery action: re-checks the pointer's originally-unavailable
 * customRoot and, if it's now reachable, switches the running app over to
 * the database that already lives there. The fallback database is left on
 * disk, since it may contain work from an earlier fallback session.
 */
export function resolveCustomStorageRoot(): Promise<StorageLocationMigrationResult> {
  return withStorageWriteLock(() => {
    const state = getStorageRecoveryState()
    if (!state.needed || !state.unavailableCustomRoot) {
      return { ok: false, error: 'No storage location recovery is currently needed.' }
    }
    const customRoot = state.unavailableCustomRoot

    if (!isCustomRootAvailable(customRoot)) {
      return { ok: false, error: `"${customRoot}" is still not available. Reconnect it and try again.` }
    }

    const fallbackRoot = activeStorageRoot()
    const result = switchToExistingRoot(customRoot, false)
    if (!result.ok) return result

    clearStorageRecoveryState()
    logResolutionBestEffort('Reconnected to custom storage location', {
      root: activeStorageRoot(),
      abandonedFallbackRoot: fallbackRoot
    })
    return { ok: true }
  })
}

/**
 * Switches to a folder that already contains Applyer data. Unlike migration,
 * this deliberately does not copy or merge the currently-active dataset.
 */
export function connectToExistingLocation(root: string): Promise<StorageLocationMigrationResult> {
  return withStorageWriteLock(() => {
    const previousRoot = activeStorageRoot()
    const result = switchToExistingRoot(root, true)
    if (!result.ok) return result

    clearStorageRecoveryState()
    logResolutionBestEffort('Connected to an existing Applyer storage location', {
      root: activeStorageRoot(),
      previousRoot
    })
    return { ok: true }
  })
}

/**
 * The "Use the default location instead" recovery action — an explicit,
 * informed choice. The database is already open at the default root from
 * boot, so only the durable pointer and recovery state need to change.
 */
export function useDefaultStorageLocation(): StorageLocationMigrationResult {
  const state = getStorageRecoveryState()
  if (!state.needed) {
    return { ok: false, error: 'No storage location recovery is currently needed.' }
  }

  try {
    writeStorageLocationPointer({ schemaVersion: 1, customRoot: null })
  } catch (err) {
    return { ok: false, error: `Could not save the default storage location: ${errorMessage(err)}` }
  }

  clearStorageRecoveryState()
  logResolutionBestEffort('Storage location recovery resolved: using the default location', {
    abandonedCustomRoot: state.unavailableCustomRoot
  })
  return { ok: true }
}

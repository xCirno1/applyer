import {
  promises as fsPromises,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  statfsSync,
  statSync,
  copyFileSync,
  cpSync,
  writeFileSync,
  unlinkSync
} from 'fs'
import { randomBytes } from 'crypto'
import { isAbsolute, join, resolve } from 'path'
import Database from 'better-sqlite3'
import { documentsDir, screenshotsDir, logsDir } from '../config/paths'
import { activeStorageRoot, defaultStorageRoot, setActiveStorageRoot, writeStorageLocationPointer } from '../config/storageLocation'
import { dbPath, openDatabaseAt, closeDatabase, checkpointDatabase } from '../db'
import { computeStorageStats } from '../storageStats'
import { logActivity } from '../db/repositories/activityLogRepository'
import { withStorageWriteLock } from '../storageWriteLock'
import { appLogger } from '../logger'
import type {
  StorageLocationValidation,
  StorageLocationMigrationResult,
  StorageLocationProgressPayload
} from '@shared/types/storageLocation'
import { appError } from '@shared/types/errorCodes'

const FREE_SPACE_MARGIN = 1.05
const MOVABLE_NAMES = ['applyer.db', 'documents', 'screenshots', 'logs']

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Resolves symlinks and (on Windows) on-disk casing before comparing paths.
 * Falls back to a plain `resolve()` when the path doesn't exist yet (the
 * common case for a brand-new destination folder) — a nonexistent path
 * can't alias an existing directory, so that fallback is safe.
 */
function canonicalPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

function isNoOp(destinationRoot: string): boolean {
  // Plain `resolve()` alone would miss a destination that's a symlink (or,
  // on Windows/macOS, a differently-cased alias) pointing at the exact same
  // physical directory as the active root — and `fs.cp` copying a directory
  // onto itself through such an alias can corrupt files (a naive copy opens
  // the destination for write-with-truncate while still reading the same
  // underlying file), not just waste time. realpath-based comparison closes
  // that gap.
  return canonicalPath(destinationRoot) === canonicalPath(activeStorageRoot())
}

/**
 * Read-only checks a destination folder before any data is touched. Reused
 * both standalone (renderer calls this right after folder-pick, before
 * showing the confirm dialog) and as step 1 of migrateStorageLocation itself.
 */
export function validateStorageDestination(destinationRoot: string): StorageLocationValidation {
  if (typeof destinationRoot !== 'string' || destinationRoot.trim() === '') {
    return { ok: false, error: appError('chooseFolder') }
  }
  if (!isAbsolute(destinationRoot)) {
    return { ok: false, error: appError('invalidFolderPath') }
  }
  if (isNoOp(destinationRoot)) {
    return { ok: true }
  }

  try {
    mkdirSync(destinationRoot, { recursive: true })
  } catch (err) {
    return { ok: false, error: appError('cannotCreateFolder', { message: errorMessage(err) }) }
  }

  try {
    if (!statSync(destinationRoot).isDirectory()) {
      return { ok: false, error: appError('pathNotFolder') }
    }
  } catch (err) {
    return { ok: false, error: appError('cannotAccessFolder', { message: errorMessage(err) }) }
  }

  const probePath = join(
    destinationRoot,
    `.applyer-write-test-${process.pid}-${randomBytes(8).toString('hex')}`
  )
  try {
    writeFileSync(probePath, '', { flag: 'wx' })
    unlinkSync(probePath)
  } catch (err) {
    return { ok: false, error: appError('folderNotWritable', { message: errorMessage(err) }) }
  }

  let entries: string[]
  try {
    entries = readdirSync(destinationRoot)
  } catch (err) {
    return { ok: false, error: appError('cannotReadFolder', { message: errorMessage(err) }) }
  }
  // Only the names we'd actually write are treated as a conflict — not "must
  // be completely empty". The OS-default userData dir permanently holds
  // workspace/, playwright-browsers/, mcp.sock, and the pointer file itself
  // (none of which are ever cleaned up, since they're pinned), so requiring
  // total emptiness would make it impossible to ever move data back there.
  // Compared case-insensitively: on Windows and default macOS (APFS) — both
  // case-insensitive filesystems — `join(root, 'documents')` and an existing
  // `Documents` entry are the SAME on-disk directory, so a case-sensitive
  // check here would miss a real conflict and let a later copy or cleanup
  // merge into (or recursively delete) the user's actual Documents folder.
  const lowerNames = new Set(entries.map((name) => name.toLowerCase()))
  const conflict = MOVABLE_NAMES.find((name) => lowerNames.has(name))
  if (conflict) {
    return {
      ok: false,
      error: appError('folderHasData', { conflict })
    }
  }

  try {
    const stats = statfsSync(destinationRoot)
    const availableBytes = stats.bavail * stats.bsize
    const neededBytes = Math.ceil(computeStorageStats().totalBytes * FREE_SPACE_MARGIN)
    if (availableBytes < neededBytes) {
      return { ok: false, error: appError('notEnoughSpace'), neededBytes, availableBytes }
    }
  } catch (err) {
    // statfsSync isn't guaranteed on every platform — don't hard-block the
    // feature on it; fall through and let a real ENOSPC surface during copy.
    appLogger.warn(`Storage location free-space check skipped: ${errorMessage(err)}`)
  }

  return { ok: true }
}

/**
 * Removes only the four movable categories under `root` — never the whole
 * directory. `root` may pre-exist with unrelated content (the OS-default
 * userData dir always does: workspace/, playwright-browsers/, mcp.sock, the
 * pointer file), so a blanket `rmSync(root, {recursive:true})` here would
 * destroy pinned, live data. Shared by the pre-commit discard path (destDbPath
 * under the not-yet-active destination) and the post-commit old-location
 * cleanup (oldDbPath under the just-vacated root).
 */
function deleteMovableData(root: string, dbPathAtRoot: string, warn: (message: string) => void): void {
  for (const path of [dbPathAtRoot, `${dbPathAtRoot}-wal`, `${dbPathAtRoot}-shm`]) {
    try {
      if (existsSync(path)) unlinkSync(path)
    } catch (err) {
      warn(`Could not remove ${path}: ${errorMessage(err)}`)
    }
  }
  for (const dir of ['documents', 'screenshots', 'logs']) {
    try {
      rmSync(join(root, dir), { recursive: true, force: true })
    } catch (err) {
      warn(`Could not remove ${join(root, dir)}: ${errorMessage(err)}`)
    }
  }
}

/** Best-effort: only ever called on a destination we know we created and haven't committed to yet. */
function discardDestination(destinationRoot: string): void {
  deleteMovableData(destinationRoot, join(destinationRoot, 'applyer.db'), (message) =>
    appLogger.warn(`Failed to clean up incomplete storage-location destination: ${message}`)
  )
}

/** Best-effort: only called after the migration has already committed to the new location. */
function deleteOldLocationData(oldRoot: string, oldDbPath: string): void {
  deleteMovableData(oldRoot, oldDbPath, (message) => logActivity('warn', message))
}

/**
 * Closes whatever connection db/index.ts currently holds (if any) and opens
 * a fresh one at `path`. Always closing first avoids leaking the previous
 * connection's file handle — important specifically when this is used to
 * roll back from a just-opened (but not yet committed) destination
 * connection back to the old one: without an explicit close, the leaked
 * handle can also block discardDestination's cleanup of the destination
 * file on Windows, where an open handle prevents deletion.
 */
function reopenAt(path: string): void {
  closeDatabase()
  openDatabaseAt(path, { runMigrations: false })
}

export interface MigrateOptions {
  onProgress?: (payload: StorageLocationProgressPayload) => void
}

// Guards against two overlapping calls (a renderer double-click racing the
// UI's disabled-state, or any future second caller). Without this, a second
// call's failure-cleanup (discardDestination) can delete data a first,
// already-committed call just wrote and is now actively serving from —
// genuine data loss, not just a wasted duplicate copy.
let migrationInProgress = false

export async function migrateStorageLocation(
  destinationRoot: string,
  opts: MigrateOptions = {}
): Promise<StorageLocationMigrationResult> {
  const onProgress = opts.onProgress ?? ((): void => {})

  if (isNoOp(destinationRoot)) {
    return { ok: true }
  }

  if (migrationInProgress) {
    return { ok: false, error: appError('migrationInProgress') }
  }
  migrationInProgress = true

  try {
    return await runMigration(destinationRoot, onProgress)
  } finally {
    migrationInProgress = false
  }
}

async function runMigration(
  destinationRoot: string,
  onProgress: (payload: StorageLocationProgressPayload) => void
): Promise<StorageLocationMigrationResult> {
  const validation = validateStorageDestination(destinationRoot)
  if (!validation.ok) {
    return { ok: false, error: validation.error }
  }

  // Use one canonical spelling for every path derived below. In particular,
  // moving through a symlink/junction/case alias of the default root must not
  // write alias-prefixed absolute paths into the database and then clear the
  // pointer as though the canonical default spelling had been used.
  const canonicalDestination = canonicalPath(destinationRoot)
  const newDocumentsDir = join(canonicalDestination, 'documents')
  const newScreenshotsDir = join(canonicalDestination, 'screenshots')
  const newLogsDir = join(canonicalDestination, 'logs')
  const destDbPath = join(canonicalDestination, 'applyer.db')
  let oldRoot = ''
  let oldDbPath = ''
  let oldDocumentsDir = ''
  let oldScreenshotsDir = ''
  let oldLogsDir = ''

  // Copy + snapshot + commit all run under the storage write lock (see
  // storageWriteLock.ts): addDocument/deleteDocument/rewriteDocumentStorageMode
  // and a filled job's screenshot capture all acquire the same lock, so none
  // of them can interleave with this copy or the DB snapshot that freezes
  // their state — they simply queue and run afterward, against the new
  // location, once this whole critical section releases the lock. That
  // makes a single copy pass (no directory-listing race to guard against)
  // sufficient and correct.
  const commitResult = await withStorageWriteLock(async (): Promise<StorageLocationMigrationResult> => {
    // Capture the source only after acquiring the lock. A connect-to-existing
    // request uses this same queue and may have changed the active database
    // while this migration was validating its destination.
    oldRoot = activeStorageRoot()
    oldDbPath = dbPath()
    oldDocumentsDir = documentsDir()
    oldScreenshotsDir = screenshotsDir()
    oldLogsDir = logsDir()

    // Phase 1 — copy. Fully abortable: old location + pointer file untouched.
    try {
      onProgress({ phase: 'documents', percent: 0 })
      await fsPromises.cp(oldDocumentsDir, newDocumentsDir, { recursive: true })
      onProgress({ phase: 'documents', percent: 100 })

      onProgress({ phase: 'screenshots', percent: 0 })
      await fsPromises.cp(oldScreenshotsDir, newScreenshotsDir, { recursive: true })
      onProgress({ phase: 'screenshots', percent: 100 })

      onProgress({ phase: 'logs', percent: 0 })
      await fsPromises.cp(oldLogsDir, newLogsDir, { recursive: true })
      // electron-log writes synchronously on the main thread. The async copy
      // above can yield between files, so repeat it synchronously as the last
      // yielding operation before the DB snapshot/root flip. No log call can
      // interleave between this return and setActiveStorageRoot(), and all
      // later writes resolve directly to newLogsDir.
      cpSync(oldLogsDir, newLogsDir, { recursive: true, force: true })
      onProgress({ phase: 'logs', percent: 100 })
    } catch (err) {
      discardDestination(canonicalDestination)
      return { ok: false, error: appError('cannotCopyData', { message: errorMessage(err) }) }
    }

    // Phase 2 — DB snapshot + verify + absolute-path rewrite. Still pre-commit.
    try {
      onProgress({ phase: 'database', percent: 0 })
      checkpointDatabase()
      copyFileSync(oldDbPath, destDbPath)
      for (const suffix of ['-wal', '-shm']) {
        if (existsSync(`${oldDbPath}${suffix}`)) copyFileSync(`${oldDbPath}${suffix}`, `${destDbPath}${suffix}`)
      }
      onProgress({ phase: 'database', percent: 100 })

      onProgress({ phase: 'verifying', percent: 0 })
      const tempDb = new Database(destDbPath)
      try {
        tempDb.prepare('UPDATE documents SET stored_path = REPLACE(stored_path, ?, ?)').run(oldDocumentsDir, newDocumentsDir)
        // jobs.screenshot_path is never dereferenced directly (the renderer
        // resolves a screenshot live, by job id, through the applyer-file://
        // protocol) but it IS echoed verbatim through jobs:get/jobs:list and
        // persisted in data exports — rewritten here so it doesn't keep
        // pointing at a directory that's about to be deleted.
        tempDb.prepare('UPDATE jobs SET screenshot_path = REPLACE(screenshot_path, ?, ?) WHERE screenshot_path IS NOT NULL').run(oldScreenshotsDir, newScreenshotsDir)
        const check = tempDb.pragma('quick_check') as { quick_check: string }[]
        if (check[0]?.quick_check !== 'ok') {
          throw new Error(`Database integrity check failed: ${check[0]?.quick_check ?? 'unknown'}`)
        }
        tempDb.prepare('SELECT count(*) FROM app_settings').get()
      } finally {
        tempDb.close()
      }
      onProgress({ phase: 'verifying', percent: 100 })
    } catch (err) {
      // Pre-commit: the rewrite runs against a disposable copy, so a failure
      // here never touches the live DB's values — just discard the whole
      // destination and leave the old location fully in charge.
      discardDestination(canonicalDestination)
      return { ok: false, error: appError('cannotPrepareDatabase', { message: errorMessage(err) }) }
    }

    // Phase 3 — commit point. Opening the new DB, persisting the pointer,
    // and flipping the in-memory active root are treated as one atomic
    // unit: if any step fails, everything rolls back to the old location
    // rather than leaving a split state where this session ends up using
    // one location (the DB connection was already reopened) while the
    // pointer file — read fresh on the next launch — still names another.
    // That split is worse than an outright failure: retrying the same
    // destination would look like a no-op (activeStorageRoot() already
    // matches it) while the underlying write failure (e.g. disk full at the
    // default-root pointer location) never actually gets resolved.
    closeDatabase()
    const isMovingToDefault = canonicalDestination === canonicalPath(defaultStorageRoot())
    try {
      openDatabaseAt(destDbPath, { runMigrations: false })
      writeStorageLocationPointer({ schemaVersion: 1, customRoot: isMovingToDefault ? null : canonicalDestination })
      setActiveStorageRoot(canonicalDestination)
    } catch (err) {
      let reopenedPrevious = false
      try {
        reopenAt(oldDbPath)
        reopenedPrevious = true
      } catch (reopenErr) {
        appLogger.error(`Failed to reopen the database at the previous storage location after a failed move: ${errorMessage(reopenErr)}`)
      }

      if (reopenedPrevious) {
        try {
          logActivity('error', 'Storage location change failed while committing the new location', {
            error: errorMessage(err)
          })
        } catch (logErr) {
          appLogger.warn(`Could not record the failed storage-location commit: ${errorMessage(logErr)}`)
        }
        discardDestination(canonicalDestination)
      } else {
        appLogger.error(
          `Preserving the complete storage-location copy at ${canonicalDestination} because the previous database could not be reopened.`
        )
      }
      return {
        ok: false,
        error: reopenedPrevious
          ? appError('migrationRolledBack')
          : appError('migrationStranded', { destination: canonicalDestination })
      }
    }

    return { ok: true }
  })

  if (!commitResult.ok) {
    return commitResult
  }

  // Phase 4 — best-effort cleanup + logging, deliberately outside the write
  // lock (queued writers can proceed against the already-committed new
  // location while this runs) and wrapped so that a failure here — the
  // activity-log insert, or the progress broadcast — can't turn an
  // already-successful commit into a reported failure. The real work
  // (opening the new DB, persisting the pointer, flipping the active root)
  // is already done and durable by this point.
  try {
    onProgress({ phase: 'finalizing', percent: 50 })
    deleteOldLocationData(oldRoot, oldDbPath)
    logActivity('info', 'Storage location changed', { from: oldRoot, to: canonicalDestination })
    onProgress({ phase: 'finalizing', percent: 100 })
  } catch (err) {
    appLogger.warn(`Storage location finalization step failed (the move itself already succeeded): ${errorMessage(err)}`)
  }

  return { ok: true }
}

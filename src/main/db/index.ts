import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'
import * as schema from './schema'
import { appLogger } from '../logger'
import { failureTags } from './schema'
import { activeStorageRoot, activeStorageRootRequiresExistingDatabase } from '../config/storageLocation'
import { BUILTIN_FAILURE_TAGS } from '@shared/constants'

/**
 * Deliberately NOT __dirname-relative: this module can end up bundled into
 * a dynamically-imported chunk (e.g. out/main/chunks/bootstrap-*.js) rather
 * than out/main/index.js, which silently breaks a relative path. app root
 * is stable regardless of how Rollup chunks things.
 */
function resolveMigrationsFolder(): string {
  const candidates = [
    join(app.getAppPath(), 'out', 'main', 'migrations'),
    // Unit tests and source-run tooling do not necessarily have a prior
    // production build. app.getAppPath() is still stable here; only the
    // migrations' project-root-relative location differs.
    join(app.getAppPath(), 'src', 'main', 'db', 'migrations')
  ]
  const found = candidates.find((candidate) => existsSync(candidate))
  if (found) return found
  throw new Error(`Could not find migrations folder (checked: ${candidates.join(', ')})`)
}

let sqlite: Database.Database | undefined
let db: ReturnType<typeof drizzle<typeof schema>> | undefined

export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (!db) {
    throw new Error('Database not initialized: call initDatabase() before getDb()')
  }
  return db
}

/** Absolute path to applyer.db under the currently active storage location. */
export function dbPath(): string {
  return join(activeStorageRoot(), 'applyer.db')
}

/**
 * Opens (or reopens) the module-level connection at an explicit path. Shared
 * by initDatabase() and the storage-location migration/recovery commit steps
 * so there's exactly one place that knows how to open a connection correctly.
 * Does not seed failure tags — callers that need a fresh/first-run DB should
 * call initDatabase() instead, which does.
 *
 * `requireExisting` defaults to true: better-sqlite3's Database constructor
 * silently *creates* a missing file by default, which is exactly wrong for
 * every caller except initDatabase()'s genuine first run at the fixed default
 * root. initDatabase derives that exception from storage resolution; a
 * configured custom root always requires its verified file to remain present.
 * Every other caller is reopening a database that was just verified to exist (a migration's
 * already-copied destination, a reconnect to a previously-used custom root,
 * a rollback to the still-there old location). Without this, a destination
 * that vanishes between verification and commit (a removable/network drive
 * disappearing at the wrong moment) would silently open as a blank, unmigrated
 * database instead of failing — the commit would then "succeed", the pointer
 * would update, and cleanup would delete the real source database, losing it.
 */
export function openDatabaseAt(
  path: string,
  options: { runMigrations: boolean; requireExisting?: boolean }
): ReturnType<typeof drizzle<typeof schema>> {
  sqlite = new Database(path, { fileMustExist: options.requireExisting ?? true })
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  db = drizzle(sqlite, { schema })
  if (options.runMigrations) {
    migrate(db, { migrationsFolder: resolveMigrationsFolder() })
  }
  return db
}

/** Flushes the WAL into the main db file — used before snapshotting the file for a storage-location migration. */
export function checkpointDatabase(): void {
  sqlite?.pragma('wal_checkpoint(TRUNCATE)')
}

export function initDatabase(): ReturnType<typeof drizzle<typeof schema>> {
  if (db) return db

  const requireExisting = activeStorageRootRequiresExistingDatabase()
  if (!requireExisting) mkdirSync(activeStorageRoot(), { recursive: true })
  const path = dbPath()

  const database = openDatabaseAt(path, { runMigrations: true, requireExisting })
  appLogger.info(`Database ready at ${path}`)

  seedFailureTags(database)

  return database
}

/** Idempotent (onConflictDoNothing) — safe, and necessary, to re-run whenever a different database becomes active mid-session, in case it predates a newer app version's builtin tags. */
export function seedFailureTags(database: ReturnType<typeof drizzle<typeof schema>>): void {
  for (const tag of BUILTIN_FAILURE_TAGS) {
    database
      .insert(failureTags)
      .values({ ...tag, isBuiltin: true })
      .onConflictDoNothing({ target: failureTags.id })
      .run()
  }
}

export function closeDatabase(): void {
  sqlite?.close()
  sqlite = undefined
  db = undefined
}

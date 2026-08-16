import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'
import * as schema from './schema'
import { appLogger } from '../logger'
import { failureTags } from './schema'

/**
 * Deliberately NOT __dirname-relative: this module can end up bundled into
 * a dynamically-imported chunk (e.g. out/main/chunks/bootstrap-*.js) rather
 * than out/main/index.js, which silently breaks a relative path. app root
 * is stable regardless of how Rollup chunks things.
 */
function resolveMigrationsFolder(): string {
  const candidate = join(app.getAppPath(), 'out', 'main', 'migrations')
  if (existsSync(candidate)) return candidate
  throw new Error(`Could not find migrations folder at ${candidate}`)
}

let sqlite: Database.Database | undefined
let db: ReturnType<typeof drizzle<typeof schema>> | undefined

const BUILTIN_FAILURE_TAGS: { id: string; label: string; description: string }[] = [
  { id: 'captcha_verification', label: 'Captcha Verification', description: 'A bot-check or CAPTCHA blocked automated access.' },
  { id: 'login_required', label: 'Login Required', description: 'The listing or application requires signing in.' },
  { id: 'form_not_supported', label: 'Form Not Supported', description: "The application form couldn't be filled automatically." },
  { id: 'expired_listing', label: 'Expired Listing', description: 'The job posting is no longer available.' },
  { id: 'duplicate', label: 'Duplicate', description: 'This job was already queued from another search.' },
  { id: 'interrupted', label: 'Interrupted', description: 'The app was closed or restarted while this job was mid-fill or waiting on a verification challenge.' },
  { id: 'other', label: 'Other', description: 'An unclassified failure occurred.' }
]

export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (!db) {
    throw new Error('Database not initialized — call initDatabase() before getDb()')
  }
  return db
}

export function initDatabase(): ReturnType<typeof drizzle<typeof schema>> {
  if (db) return db

  const userDataDir = app.getPath('userData')
  mkdirSync(userDataDir, { recursive: true })
  const dbPath = join(userDataDir, 'applyer.db')

  sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  db = drizzle(sqlite, { schema })

  migrate(db, { migrationsFolder: resolveMigrationsFolder() })
  appLogger.info(`Database ready at ${dbPath}`)

  seedFailureTags(db)

  return db
}

function seedFailureTags(database: ReturnType<typeof drizzle<typeof schema>>): void {
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

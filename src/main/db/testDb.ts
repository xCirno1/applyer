// Test-only helper: a fresh in-memory SQLite database with the *real*
// migrations applied (not a hand-rolled schema copy), so repository tests
// exercise the same schema production runs against. Not named `*.test.ts`
// so Vitest doesn't try to collect it as a suite itself.
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import * as schema from './schema'

const MIGRATIONS_FOLDER = join(__dirname, 'migrations')

export function createTestDb(): { db: ReturnType<typeof drizzle<typeof schema>>; sqlite: Database.Database } {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
  return { db, sqlite }
}

interface JournalEntry {
  idx: number
  tag: string
}

/**
 * The same database migrated only up to journal index `upToIdx`, for tests
 * that seed rows in an older shape and then run the remaining migrations
 * with `migrateTestDb`. Built by copying the real folder with the journal
 * truncated, since the migrator applies every entry it finds.
 */
export function createTestDbAt(upToIdx: number): { db: ReturnType<typeof drizzle<typeof schema>>; sqlite: Database.Database } {
  const journalPath = join(MIGRATIONS_FOLDER, 'meta', '_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf-8')) as { entries: JournalEntry[] }
  const folder = mkdtempSync(join(tmpdir(), 'applyer-migrations-'))
  mkdirSync(join(folder, 'meta'))
  const entries = journal.entries.filter((entry) => entry.idx <= upToIdx)
  for (const entry of entries) {
    copyFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`))
  }
  writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }))

  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: folder })
  return { db, sqlite }
}

/** Applies whatever migrations `createTestDbAt` left out. */
export function migrateTestDb(db: ReturnType<typeof drizzle<typeof schema>>): void {
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
}

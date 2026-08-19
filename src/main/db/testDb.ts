// Test-only helper: a fresh in-memory SQLite database with the *real*
// migrations applied (not a hand-rolled schema copy), so repository tests
// exercise the same schema production runs against. Not named `*.test.ts`
// so Vitest doesn't try to collect it as a suite itself.
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { join } from 'path'
import * as schema from './schema'

export function createTestDb(): { db: ReturnType<typeof drizzle<typeof schema>>; sqlite: Database.Database } {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: join(__dirname, 'migrations') })
  return { db, sqlite }
}

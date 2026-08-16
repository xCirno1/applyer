/**
 * Standalone migration runner — applies drizzle migrations to a local SQLite
 * file without launching Electron. Useful for verifying the schema/migrations
 * are valid, and as a smoke check before packaging.
 *
 * Usage: tsx scripts/migrate.ts [path-to-db-file]
 */
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { resolve, dirname } from 'path'
import { mkdirSync } from 'fs'

const dbPath = process.argv[2] ?? resolve(process.cwd(), '.tmp/applyer.smoke.db')
mkdirSync(dirname(dbPath), { recursive: true })

const sqlite = new Database(dbPath)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

const db = drizzle(sqlite)
migrate(db, { migrationsFolder: resolve(process.cwd(), 'src/main/db/migrations') })

console.log(`Migrations applied cleanly to ${dbPath}`)
sqlite.close()

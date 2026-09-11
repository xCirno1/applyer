import { app, safeStorage } from 'electron'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { isEncryptionAvailable } from './encryption'

const KEY_FILENAME = 'database-key.enc'

export function databaseKeyPath(): string {
  return join(app.getPath('userData'), KEY_FILENAME)
}

export function readDatabaseKey(): Buffer | null {
  const path = databaseKeyPath()
  if (!existsSync(path)) return null
  if (!isEncryptionAvailable()) {
    throw new Error('The database is encrypted, but the secure OS keychain is unavailable.')
  }
  const encoded = safeStorage.decryptString(readFileSync(path))
  const key = Buffer.from(encoded, 'base64')
  if (key.byteLength !== 32) throw new Error('The encrypted database key is invalid or corrupted.')
  return key
}

function persistDatabaseKey(key: Buffer): void {
  if (!isEncryptionAvailable()) {
    throw new Error('Cannot encrypt the database without a secure OS keychain.')
  }
  const path = databaseKeyPath()
  const tempPath = `${path}.tmp`
  writeFileSync(tempPath, safeStorage.encryptString(key.toString('base64')), { mode: 0o600 })
  renameSync(tempPath, path)
}

export interface OpenCipherDatabaseResult {
  sqlite: Database.Database
  encrypted: boolean
}

/** Opens with the stored key first, then safely recognizes a stale key beside a plaintext DB. */
export function openCipherDatabase(path: string, options: Database.Options): OpenCipherDatabaseResult {
  let key: Buffer | null
  try {
    key = readDatabaseKey()
  } catch (keyError) {
    // A retained key may belong to another storage location after this one
    // was deliberately decrypted. Prove this database is plaintext before
    // allowing it to open without the unavailable keychain.
    const candidate = new Database(path, options)
    try {
      candidate.prepare('SELECT count(*) FROM sqlite_master').get()
      return { sqlite: candidate, encrypted: false }
    } catch {
      candidate.close()
      throw keyError
    }
  }
  if (!key) {
    const candidate = new Database(path, options)
    try {
      candidate.prepare('SELECT count(*) FROM sqlite_master').get()
      return { sqlite: candidate, encrypted: false }
    } catch (err) {
      candidate.close()
      throw new Error(`The database cannot be read and its wrapped encryption key is missing: ${String(err)}`)
    }
  }

  let candidate = new Database(path, options)
  try {
    candidate.key(key)
    candidate.prepare('SELECT count(*) FROM sqlite_master').get()
    return { sqlite: candidate, encrypted: true }
  } catch (encryptedOpenError) {
    candidate.close()
    candidate = new Database(path, options)
    try {
      candidate.prepare('SELECT count(*) FROM sqlite_master').get()
      return { sqlite: candidate, encrypted: false }
    } catch {
      candidate.close()
      throw new Error(`Could not unlock the encrypted database: ${String(encryptedOpenError)}`)
    }
  }
}

/**
 * SQLite3MultipleCiphers cannot rekey a database while WAL journaling is
 * active. Production connections use WAL, so conversion must checkpoint and
 * temporarily switch to the rollback journal. Restore WAL even after a
 * failed rekey so the still-open connection remains in its expected mode.
 */
function rekeyOpenDatabase(sqlite: Database.Database, key: Buffer): void {
  const currentMode = sqlite.pragma('journal_mode', { simple: true })
  const restoreWal = typeof currentMode === 'string' && currentMode.toLowerCase() === 'wal'

  if (restoreWal) {
    sqlite.pragma('wal_checkpoint(TRUNCATE)')
    const switchedMode = sqlite.pragma('journal_mode = DELETE', { simple: true })
    if (typeof switchedMode !== 'string' || switchedMode.toLowerCase() !== 'delete') {
      throw new Error(`Could not leave WAL mode before database conversion (received ${String(switchedMode)}).`)
    }
  }

  let rekeyFailed = false
  let rekeyError: unknown
  try {
    sqlite.rekey(key)
  } catch (error) {
    rekeyFailed = true
    rekeyError = error
  }

  let restoreFailed = false
  let restoreError: unknown
  if (restoreWal) {
    try {
      const restoredMode = sqlite.pragma('journal_mode = WAL', { simple: true })
      if (typeof restoredMode !== 'string' || restoredMode.toLowerCase() !== 'wal') {
        throw new Error(`Could not restore WAL mode after database conversion (received ${String(restoredMode)}).`)
      }
    } catch (error) {
      restoreFailed = true
      restoreError = error
    }
  }

  if (rekeyFailed) throw rekeyError
  if (restoreFailed) throw restoreError
}

export function encryptOpenDatabase(sqlite: Database.Database): void {
  if (!isEncryptionAvailable()) throw new Error('Cannot encrypt the database without a secure OS keychain.')
  const existingKey = readDatabaseKey()
  const key = existingKey ?? randomBytes(32)
  if (!existingKey) persistDatabaseKey(key)
  try {
    rekeyOpenDatabase(sqlite, key)
  } catch (err) {
    // Retain a newly persisted key after any ambiguous rekey failure. If the
    // database stayed plaintext, openCipherDatabase safely recognizes the
    // stale key. If rekey committed before reporting an error, deleting the
    // only wrapped copy of the key would make the database unrecoverable.
    throw new Error(`Could not encrypt database pages: ${String(err)}`)
  }
}

export function decryptOpenDatabase(sqlite: Database.Database): void {
  try {
    rekeyOpenDatabase(sqlite, Buffer.alloc(0))
  } catch (err) {
    throw new Error(`Could not decrypt database pages: ${String(err)}`)
  }
  // Keep the wrapped key: another storage location owned by this install may
  // still contain an encrypted database, and a future opt-in can reuse it.
}

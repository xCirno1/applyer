import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from 'electron'
import { __resetElectronMock, __setEncryptionAvailable } from '../../../test/mocks/electron'
import {
  databaseKeyPath,
  decryptOpenDatabase,
  encryptOpenDatabase,
  openCipherDatabase,
  readDatabaseKey
} from './databaseEncryption'
import { closeDatabase, isDatabaseEncryptedAtRest, openDatabaseAt } from './index'

beforeEach(() => {
  closeDatabase()
  __resetElectronMock()
})

afterEach(() => closeDatabase())

describe('whole-database encryption', () => {
  it('encrypts every SQLite page and reopens it with the wrapped key', () => {
    const path = join(app.getPath('userData'), 'all-data.db')
    const sqlite = new Database(path)
    sqlite.exec('CREATE TABLE secrets (value TEXT NOT NULL)')
    sqlite.prepare('INSERT INTO secrets(value) VALUES (?)').run('not-visible-on-disk')

    encryptOpenDatabase(sqlite)
    sqlite.close()

    expect(readDatabaseKey()).toHaveLength(32)
    expect(readFileSync(databaseKeyPath()).toString()).not.toContain('not-visible-on-disk')
    expect(readFileSync(path).toString()).not.toContain('not-visible-on-disk')

    const opened = openCipherDatabase(path, { fileMustExist: true })
    expect(opened.encrypted).toBe(true)
    expect(opened.sqlite.prepare('SELECT value FROM secrets').pluck().get()).toBe('not-visible-on-disk')
    opened.sqlite.close()
  })

  it('converts a production WAL database and restores WAL afterwards', () => {
    const path = join(app.getPath('userData'), 'wal.db')
    const sqlite = new Database(path)
    sqlite.exec('CREATE TABLE secrets (value TEXT NOT NULL)')
    expect(sqlite.pragma('journal_mode = WAL', { simple: true })).toBe('wal')
    sqlite.prepare('INSERT INTO secrets(value) VALUES (?)').run('wal-secret')

    encryptOpenDatabase(sqlite)
    expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal')
    decryptOpenDatabase(sqlite)
    expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(sqlite.prepare('SELECT value FROM secrets').pluck().get()).toBe('wal-secret')
    sqlite.close()
  })

  it('can deliberately return the database to plaintext mode', () => {
    const path = join(app.getPath('userData'), 'roundtrip.db')
    const sqlite = new Database(path)
    sqlite.exec("CREATE TABLE secrets (value TEXT NOT NULL); INSERT INTO secrets VALUES ('roundtrip-secret')")
    encryptOpenDatabase(sqlite)
    decryptOpenDatabase(sqlite)
    sqlite.close()

    const plain = new Database(path, { fileMustExist: true })
    expect(plain.prepare('SELECT value FROM secrets').pluck().get()).toBe('roundtrip-secret')
    plain.close()

    // A retained wrapped key may belong to another storage location. Losing
    // keychain access must not prevent a proven-plaintext DB from opening.
    __setEncryptionAvailable(false)
    const reopened = openCipherDatabase(path, { fileMustExist: true })
    expect(reopened.encrypted).toBe(false)
    reopened.sqlite.close()
  })

  it('refuses to create an encrypted database when the keychain is unavailable', () => {
    const path = join(app.getPath('userData'), 'unavailable.db')
    const sqlite = new Database(path)
    __setEncryptionAvailable(false)
    expect(() => encryptOpenDatabase(sqlite)).toThrow(/secure OS keychain/)
    sqlite.close()
  })

  it('refuses to open encrypted pages when the wrapped key cannot be read', () => {
    const path = join(app.getPath('userData'), 'locked.db')
    const sqlite = new Database(path)
    sqlite.exec('CREATE TABLE secrets (value TEXT)')
    encryptOpenDatabase(sqlite)
    sqlite.close()
    __setEncryptionAvailable(false)
    expect(() => openCipherDatabase(path, { fileMustExist: true })).toThrow(/keychain is unavailable/)
  })

  it('retains a new wrapped key after an ambiguous rekey failure', () => {
    const path = join(app.getPath('userData'), 'failed-rekey.db')
    const sqlite = new Database(path)
    sqlite.exec('CREATE TABLE secrets (value TEXT)')
    vi.spyOn(sqlite, 'rekey').mockImplementation(() => {
      throw new Error('simulated failure')
    })

    expect(() => encryptOpenDatabase(sqlite)).toThrow(/Could not encrypt database pages/)
    expect(readDatabaseKey()).toHaveLength(32)
    sqlite.close()
  })

  it.each(['encrypted', 'plaintext'] as const)('respects a stored %s mode when opening', (mode) => {
    const path = join(app.getPath('userData'), `${mode}-preference.db`)
    const sqlite = new Database(path)
    sqlite.exec('CREATE TABLE app_settings (`key` TEXT PRIMARY KEY NOT NULL, `value` TEXT NOT NULL)')
    sqlite.prepare('INSERT INTO app_settings (`key`, `value`) VALUES (?, ?)').run('storage_mode', mode)
    sqlite.close()

    openDatabaseAt(path, { runMigrations: false, requireExisting: true })
    expect(isDatabaseEncryptedAtRest()).toBe(mode === 'encrypted')
    closeDatabase()

    const plain = new Database(path, { fileMustExist: true })
    if (mode === 'plaintext') {
      expect(plain.prepare("SELECT value FROM app_settings WHERE key = 'storage_mode'").pluck().get()).toBe(
        'plaintext'
      )
    } else {
      expect(() => plain.prepare('SELECT count(*) FROM sqlite_master').get()).toThrow()
    }
    plain.close()
  })
})

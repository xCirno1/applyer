import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from 'electron'
import { __resetElectronMock, __setEncryptionAvailable } from '../../../test/mocks/electron'
import {
  databaseKeyPath,
  decryptOpenDatabase,
  encryptOpenDatabase,
  openCipherDatabase,
  readDatabaseKey
} from './databaseEncryption'

beforeEach(() => __resetElectronMock())

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
})

import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate as runMigrations } from 'drizzle-orm/better-sqlite3/migrator'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { __resetElectronMock } from '../../../test/mocks/electron'
import {
  resolveActiveStorageRoot,
  activeStorageRoot,
  writeStorageLocationPointer,
  readStorageLocationPointer,
  getStorageRecoveryState
} from '../config/storageLocation'
import * as dbModule from '../db'
import { eq } from 'drizzle-orm'
import { jobs, profile } from '../db/schema'
import * as activityLogModule from '../db/repositories/activityLogRepository'
import * as storageConfigModule from '../config/storageLocation'
import { connectToExistingLocation, resolveCustomStorageRoot, useDefaultStorageLocation } from './recovery'

function createMigratedDbFile(path: string): void {
  const sqlite = new Database(path)
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema: { profile } })
  runMigrations(db, { migrationsFolder: join(__dirname, '../db/migrations') })
  sqlite.close()
}

/**
 * Simulates a real boot with an unavailable custom root: resolveActiveStorageRoot()
 * falls back to the default root and requests recovery, then — like
 * bootstrap.ts's initDatabase() — a database is opened at whatever
 * activeStorageRoot() ended up being.
 */
function bootIntoFallback(customRoot: string): void {
  writeStorageLocationPointer({ schemaVersion: 1, customRoot })
  resolveActiveStorageRoot()
  createMigratedDbFile(dbModule.dbPath())
  dbModule.openDatabaseAt(dbModule.dbPath(), { runMigrations: false })
}

beforeEach(() => {
  dbModule.closeDatabase()
  __resetElectronMock()
})

describe('resolveCustomStorageRoot', () => {
  it('fails when no recovery is currently needed', async () => {
    resolveActiveStorageRoot()
    await expect(resolveCustomStorageRoot()).resolves.toEqual({ ok: false, error: expect.objectContaining({ code: expect.any(String) }) })
  })

  it('fails while the custom root is still unavailable', async () => {
    const missingRoot = join(tmpdir(), 'applyer-recovery-missing-root')
    bootIntoFallback(missingRoot)

    const result = await resolveCustomStorageRoot()

    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: expect.any(String) }) })
    expect(getStorageRecoveryState().needed).toBe(true)
    expect(activeStorageRoot()).not.toBe(missingRoot)
  })

  it('reconnects once the custom root becomes available and reruns database startup maintenance', async () => {
    const customRoot = join(tmpdir(), `applyer-recovery-custom-${process.pid}-${Date.now()}`)
    bootIntoFallback(customRoot)
    expect(getStorageRecoveryState().needed).toBe(true)

    // Simulate the drive reconnecting: the folder, with its own
    // previously-used database, now exists.
    mkdirSync(customRoot, { recursive: true })
    createMigratedDbFile(join(customRoot, 'applyer.db'))
    const customSqlite = new Database(join(customRoot, 'applyer.db'))
    customSqlite
      .prepare(
        `INSERT INTO jobs (id, title, company, url, status, blocking_reason, blocking_task_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run('blocked-job', 'Engineer', 'Acme', 'https://acme.example/blocked', 'queued', 'captcha', 'task-1')
    customSqlite.close()

    const result = await resolveCustomStorageRoot()

    expect(result).toEqual({ ok: true })
    expect(activeStorageRoot()).toBe(customRoot)
    expect(getStorageRecoveryState().needed).toBe(false)
    // Genuinely usable — not just flagged, actually opened.
    expect(() => dbModule.getDb().select().from(profile).all()).not.toThrow()
    const recoveredJob = dbModule.getDb().select().from(jobs).where(eq(jobs.id, 'blocked-job')).get()
    expect(recoveredJob).toMatchObject({
      status: 'failed',
      failureTag: 'interrupted',
      blockingReason: null,
      blockingTaskId: null
    })

    rmSync(customRoot, { recursive: true, force: true })
  })

  it('keeps a successful reconnect successful when activity logging fails', async () => {
    const customRoot = join(tmpdir(), `applyer-recovery-log-failure-${process.pid}-${Date.now()}`)
    bootIntoFallback(customRoot)
    mkdirSync(customRoot, { recursive: true })
    createMigratedDbFile(join(customRoot, 'applyer.db'))
    const logSpy = vi.spyOn(activityLogModule, 'logActivity').mockImplementationOnce(() => {
      throw new Error('simulated logging failure')
    })

    await expect(resolveCustomStorageRoot()).resolves.toEqual({ ok: true })
    expect(activeStorageRoot()).toBe(customRoot)
    expect(getStorageRecoveryState().needed).toBe(false)

    logSpy.mockRestore()
    rmSync(customRoot, { recursive: true, force: true })
  })
})

describe('connectToExistingLocation', () => {
  function openDefaultDatabase(): void {
    resolveActiveStorageRoot()
    createMigratedDbFile(dbModule.dbPath())
    dbModule.openDatabaseAt(dbModule.dbPath(), { runMigrations: false })
  }

  it('persists an existing Applyer folder without live-swapping the active database', async () => {
    openDefaultDatabase()
    const previousRoot = activeStorageRoot()
    const existingRoot = join(tmpdir(), `applyer-existing-${process.pid}-${Date.now()}`)
    mkdirSync(existingRoot, { recursive: true })
    createMigratedDbFile(join(existingRoot, 'applyer.db'))

    const result = await connectToExistingLocation(existingRoot)

    expect(result).toEqual({ ok: true })
    // The IPC handler restarts the main process after this result. Until
    // then, continuations begun against the old dataset must stay on it.
    expect(activeStorageRoot()).toBe(previousRoot)
    expect(readStorageLocationPointer().pointer.customRoot).toBe(existingRoot)
    expect(() => dbModule.getDb().select().from(profile).all()).not.toThrow()

    rmSync(existingRoot, { recursive: true, force: true })
  })

  it('rejects a folder without an Applyer database', async () => {
    openDefaultDatabase()
    const emptyRoot = join(tmpdir(), `applyer-existing-empty-${process.pid}-${Date.now()}`)
    mkdirSync(emptyRoot, { recursive: true })
    const previousRoot = activeStorageRoot()

    const result = await connectToExistingLocation(emptyRoot)

    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: expect.any(String) }) })
    expect(activeStorageRoot()).toBe(previousRoot)
    rmSync(emptyRoot, { recursive: true, force: true })
  })

  it('rejects an unrelated SQLite database without modifying it', async () => {
    openDefaultDatabase()
    const previousRoot = activeStorageRoot()
    const existingRoot = join(tmpdir(), `applyer-existing-unrelated-${process.pid}-${Date.now()}`)
    mkdirSync(existingRoot, { recursive: true })
    const unrelatedPath = join(existingRoot, 'applyer.db')
    const sqlite = new Database(unrelatedPath)
    sqlite.exec('CREATE TABLE unrelated (value TEXT)')
    sqlite.close()

    const result = await connectToExistingLocation(existingRoot)

    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: expect.any(String) }) })
    expect(activeStorageRoot()).toBe(previousRoot)
    expect(() => dbModule.getDb().select().from(profile).all()).not.toThrow()
    const verification = new Database(unrelatedPath, { readonly: true })
    expect(verification.prepare("SELECT name FROM sqlite_master WHERE name = 'unrelated'").get()).toBeTruthy()
    expect(verification.prepare("SELECT name FROM sqlite_master WHERE name = 'app_settings'").get()).toBeUndefined()
    verification.close()

    rmSync(existingRoot, { recursive: true, force: true })
  })

  it('rolls back to the previous connection when the new pointer cannot be persisted', async () => {
    openDefaultDatabase()
    const previousRoot = activeStorageRoot()
    const existingRoot = join(tmpdir(), `applyer-existing-pointer-failure-${process.pid}-${Date.now()}`)
    mkdirSync(existingRoot, { recursive: true })
    createMigratedDbFile(join(existingRoot, 'applyer.db'))
    const pointerSpy = vi.spyOn(storageConfigModule, 'writeStorageLocationPointer').mockImplementationOnce(() => {
      throw new Error('simulated pointer failure')
    })

    const result = await connectToExistingLocation(existingRoot)

    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: expect.any(String) }) })
    expect(activeStorageRoot()).toBe(previousRoot)
    expect(readStorageLocationPointer().pointer.customRoot).toBeNull()
    expect(() => dbModule.getDb().select().from(profile).all()).not.toThrow()

    pointerSpy.mockRestore()
    rmSync(existingRoot, { recursive: true, force: true })
  })
})

describe('useDefaultStorageLocation', () => {
  it('fails when no recovery is currently needed', () => {
    resolveActiveStorageRoot()
    expect(useDefaultStorageLocation()).toEqual({ ok: false, error: expect.objectContaining({ code: expect.any(String) }) })
  })

  it('clears the pointer and recovery state, leaving the already-open fallback database active', () => {
    const missingRoot = join(tmpdir(), 'applyer-recovery-abandoned-root')
    bootIntoFallback(missingRoot)
    const fallbackRoot = activeStorageRoot()

    const result = useDefaultStorageLocation()

    expect(result).toEqual({ ok: true })
    expect(getStorageRecoveryState().needed).toBe(false)
    expect(activeStorageRoot()).toBe(fallbackRoot)
    expect(readStorageLocationPointer().pointer.customRoot).toBeNull()
    expect(() => dbModule.getDb().select().from(profile).all()).not.toThrow()
  })

  it('keeps a successful resolution successful when activity logging fails', () => {
    const missingRoot = join(tmpdir(), 'applyer-recovery-default-log-failure')
    bootIntoFallback(missingRoot)
    const logSpy = vi.spyOn(activityLogModule, 'logActivity').mockImplementationOnce(() => {
      throw new Error('simulated logging failure')
    })

    expect(useDefaultStorageLocation()).toEqual({ ok: true })
    expect(getStorageRecoveryState().needed).toBe(false)

    logSpy.mockRestore()
  })

  it('returns an error and leaves recovery active when pointer persistence fails', () => {
    const missingRoot = join(tmpdir(), 'applyer-recovery-default-pointer-failure')
    bootIntoFallback(missingRoot)
    const pointerSpy = vi.spyOn(storageConfigModule, 'writeStorageLocationPointer').mockImplementationOnce(() => {
      throw new Error('simulated pointer failure')
    })

    expect(useDefaultStorageLocation()).toEqual({ ok: false, error: expect.objectContaining({ code: expect.any(String) }) })
    expect(getStorageRecoveryState().needed).toBe(true)

    pointerSpy.mockRestore()
  })
})

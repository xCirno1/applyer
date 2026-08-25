import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate as runMigrations } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import {
  appendFileSync,
  promises as fsPromises,
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  readFileSync,
  existsSync,
  statfsSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { __resetElectronMock } from '../../../test/mocks/electron'

// Node's built-in `fs` module namespace is frozen — vi.spyOn can't redefine
// one of its exports directly, so statfsSync needs a real vi.mock (with a
// call-through default) to be overridable in the one test that needs it.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, statfsSync: vi.fn(actual.statfsSync) }
})
import { resolveActiveStorageRoot, activeStorageRoot, readStorageLocationPointer } from '../config/storageLocation'
import * as storageConfigModule from '../config/storageLocation'
import { documentsDir, screenshotsDir, logsDir } from '../config/paths'
import * as dbModule from '../db'
import { documents, profile, jobs } from '../db/schema'
import { addDocument, readDocumentBytes } from '../db/repositories/documentsRepository'
import { validateStorageDestination, migrateStorageLocation } from './migrate'

function seedOldLocationDb(): void {
  const path = dbModule.dbPath()
  const sqlite = new Database(path)
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema: { documents, profile } })
  runMigrations(db, { migrationsFolder: join(__dirname, '../db/migrations') })

  db.insert(profile).values({}).run()
  const docPath = join(documentsDir(), 'doc1')
  writeFileSync(docPath, 'hello resume')
  db.insert(documents)
    .values({
      id: 'doc1',
      profileId: 1,
      kind: 'resume',
      originalFilename: 'resume.txt',
      storedPath: docPath,
      mimeType: 'text/plain',
      sizeBytes: 13,
      isEncryptedAtRest: false
    })
    .run()
  sqlite.close()
}

function makeEmptyTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'applyer-storage-dest-'))
}

beforeEach(() => {
  dbModule.closeDatabase()
  __resetElectronMock()
  resolveActiveStorageRoot()
})

describe('validateStorageDestination', () => {
  it('accepts an empty, writable, absolute destination', () => {
    const dest = makeEmptyTempDir()
    expect(validateStorageDestination(dest)).toEqual({ ok: true })
  })

  it('rejects a relative path', () => {
    expect(validateStorageDestination('relative/path')).toEqual({ ok: false, error: { code: 'invalidFolderPath' } })
  })

  it('rejects a path that exists as a file, not a folder', () => {
    const parent = makeEmptyTempDir()
    const filePath = join(parent, 'not-a-folder')
    writeFileSync(filePath, 'x')
    const result = validateStorageDestination(filePath)
    expect(result.ok).toBe(false)
  })

  it('tolerates unrelated existing content (not a strict-emptiness check)', () => {
    // The OS-default userData dir permanently holds workspace/,
    // playwright-browsers/, mcp.sock, and the pointer file itself — none of
    // which are ever cleaned up. A strict "must be empty" rule would make it
    // impossible to ever move data back there.
    const dest = makeEmptyTempDir()
    writeFileSync(join(dest, 'unrelated-file.txt'), 'x')
    mkdirSync(join(dest, 'workspace'))
    expect(validateStorageDestination(dest)).toEqual({ ok: true })
  })

  it('does not overwrite or delete the old predictable writability-probe name', () => {
    const dest = makeEmptyTempDir()
    const oldProbePath = join(dest, `.applyer-write-test-${process.pid}`)
    writeFileSync(oldProbePath, 'keep-me')

    expect(validateStorageDestination(dest)).toEqual({ ok: true })
    expect(readFileSync(oldProbePath, 'utf-8')).toBe('keep-me')
  })

  it('rejects a destination that already has Applyer data in it', () => {
    const dest = makeEmptyTempDir()
    mkdirSync(join(dest, 'documents'))
    const result = validateStorageDestination(dest)
    expect(result.ok).toBe(false)
  })

  it('is a no-op success for the current active location', () => {
    expect(validateStorageDestination(activeStorageRoot())).toEqual({ ok: true })
  })

  it('reports insufficient free space', () => {
    // computeStorageStats() (used for the "needed bytes" side of the check)
    // requires an open DB connection registered with db/index.ts's singleton
    // — seedOldLocationDb() alone uses its own throwaway connection.
    seedOldLocationDb()
    dbModule.openDatabaseAt(dbModule.dbPath(), { runMigrations: false })
    const dest = makeEmptyTempDir()
    const fakeStats = { bavail: 1, bsize: 1 } as unknown as ReturnType<typeof statfsSync>
    vi.mocked(statfsSync).mockReturnValueOnce(fakeStats)
    const result = validateStorageDestination(dest)
    expect(result).toMatchObject({ ok: false })
  })
})

describe('migrateStorageLocation', () => {
  it('is a no-op when the destination resolves to the current active root', async () => {
    seedOldLocationDb()
    const result = await migrateStorageLocation(activeStorageRoot())
    expect(result).toEqual({ ok: true })
  })

  it('moves the database and documents, rewrites storedPath, and cleans up the old location', async () => {
    seedOldLocationDb()
    const oldRoot = activeStorageRoot()
    const oldDbPath = dbModule.dbPath()
    const dest = makeEmptyTempDir()

    const progressPhases: string[] = []
    const result = await migrateStorageLocation(dest, { onProgress: (p) => progressPhases.push(p.phase) })

    expect(result).toEqual({ ok: true })
    expect(activeStorageRoot()).toBe(dest)
    expect(readStorageLocationPointer().pointer.customRoot).toBe(dest)
    expect(progressPhases).toContain('documents')
    expect(progressPhases).toContain('database')

    expect(existsSync(join(dest, 'applyer.db'))).toBe(true)
    expect(existsSync(join(dest, 'documents', 'doc1'))).toBe(true)

    const row = dbModule.getDb().select().from(documents).where(eq(documents.id, 'doc1')).get()
    expect(row?.storedPath).toBe(join(dest, 'documents', 'doc1'))

    expect(existsSync(oldDbPath)).toBe(false)
    expect(existsSync(join(oldRoot, 'documents'))).toBe(false)
  })

  it('discards the destination and leaves the old location untouched if the copy fails', async () => {
    seedOldLocationDb()
    const oldRoot = activeStorageRoot()
    const oldDbPath = dbModule.dbPath()
    const dest = makeEmptyTempDir()

    const cpSpy = vi.spyOn(fsPromises, 'cp').mockRejectedValueOnce(new Error('simulated disk error'))
    const result = await migrateStorageLocation(dest)
    cpSpy.mockRestore()

    expect(result.ok).toBe(false)
    // Only the categories we might have created are cleaned up — not the
    // whole destination folder, which may pre-exist with unrelated content.
    expect(existsSync(join(dest, 'applyer.db'))).toBe(false)
    expect(existsSync(join(dest, 'documents'))).toBe(false)
    expect(activeStorageRoot()).toBe(oldRoot)
    expect(readStorageLocationPointer().pointer.customRoot).toBeNull()
    expect(existsSync(oldDbPath)).toBe(true)
    expect(existsSync(join(documentsDir(), 'doc1'))).toBe(true)
  })

  it('round-trips: moving back to the original default location succeeds and preserves pinned data there', async () => {
    seedOldLocationDb()
    const defaultRoot = activeStorageRoot()

    // Simulate the pinned data that always lives at the default location
    // (workspace/, in reality) and is never part of a move.
    const workspaceMarker = join(defaultRoot, 'workspace', 'marker.txt')
    mkdirSync(join(defaultRoot, 'workspace'), { recursive: true })
    writeFileSync(workspaceMarker, 'keep-me')

    const customRoot = makeEmptyTempDir()
    const awayResult = await migrateStorageLocation(customRoot)
    expect(awayResult).toEqual({ ok: true })
    // The pinned marker must survive being left behind at the vacated default root.
    expect(readFileSync(workspaceMarker, 'utf-8')).toBe('keep-me')

    const backResult = await migrateStorageLocation(defaultRoot)
    expect(backResult).toEqual({ ok: true })

    expect(activeStorageRoot()).toBe(defaultRoot)
    // Moving back to the literal default clears the pointer override entirely.
    expect(readStorageLocationPointer().pointer.customRoot).toBeNull()
    expect(existsSync(join(defaultRoot, 'applyer.db'))).toBe(true)
    expect(existsSync(join(defaultRoot, 'documents', 'doc1'))).toBe(true)
    // The pinned marker is untouched by the move back.
    expect(readFileSync(workspaceMarker, 'utf-8')).toBe('keep-me')
    // The abandoned custom location's data was cleaned up.
    expect(existsSync(join(customRoot, 'applyer.db'))).toBe(false)
  })

  it('falls back to reopening the old database if opening the new one fails at the commit point', async () => {
    seedOldLocationDb()
    const oldRoot = activeStorageRoot()
    const dest = makeEmptyTempDir()

    const openSpy = vi.spyOn(dbModule, 'openDatabaseAt').mockImplementationOnce(() => {
      throw new Error('simulated open failure')
    })
    const result = await migrateStorageLocation(dest)
    openSpy.mockRestore()

    expect(result.ok).toBe(false)
    expect(activeStorageRoot()).toBe(oldRoot)
    expect(readStorageLocationPointer().pointer.customRoot).toBeNull()
    // The DB must still be usable at the old location after the fallback reopen.
    expect(() => dbModule.getDb().select().from(documents).all()).not.toThrow()
  })

  it('preserves the verified destination when pointer persistence and fallback reopen both fail', async () => {
    seedOldLocationDb()
    const dest = makeEmptyTempDir()
    const originalOpen = dbModule.openDatabaseAt
    let openCalls = 0
    const openSpy = vi.spyOn(dbModule, 'openDatabaseAt').mockImplementation((...args) => {
      openCalls += 1
      if (openCalls === 2) throw new Error('simulated fallback disappearance')
      return originalOpen(...args)
    })
    const pointerSpy = vi.spyOn(storageConfigModule, 'writeStorageLocationPointer').mockImplementationOnce(() => {
      throw new Error('simulated pointer failure')
    })

    const result = await migrateStorageLocation(dest)

    expect(result).toEqual({ ok: false, error: { code: 'migrationStranded', params: { destination: dest } } })
    expect(existsSync(join(dest, 'applyer.db'))).toBe(true)
    expect(existsSync(join(dest, 'documents', 'doc1'))).toBe(true)

    pointerSpy.mockRestore()
    openSpy.mockRestore()
  })

  it('rejects a second concurrent call while one is already running, without touching its data', async () => {
    seedOldLocationDb()
    const destA = makeEmptyTempDir()
    const destB = makeEmptyTempDir()

    // Not awaited: migrateStorageLocation runs synchronously up to its first
    // `await` (inside the screenshots copy), so the re-entrancy flag is
    // already set by the time the next line runs.
    const first = migrateStorageLocation(destA)
    const second = await migrateStorageLocation(destB)

    expect(second).toEqual({ ok: false, error: { code: 'migrationInProgress' } })
    // Critically: rejecting the second call must not have run any cleanup
    // against the first call's in-flight destination.
    const firstResult = await first
    expect(firstResult).toEqual({ ok: true })
    expect(existsSync(join(destA, 'applyer.db'))).toBe(true)
  })

  it('treats a symlinked alias of the active root as a no-op instead of copying it onto itself', async () => {
    seedOldLocationDb()
    const oldRoot = activeStorageRoot()
    const aliasPath = join(tmpdir(), `applyer-storage-alias-${process.pid}-${Date.now()}`)
    symlinkSync(oldRoot, aliasPath, 'dir')
    try {
      const result = await migrateStorageLocation(aliasPath)
      expect(result).toEqual({ ok: true })
      // Genuinely a no-op: nothing was touched, active root unchanged.
      expect(activeStorageRoot()).toBe(oldRoot)
      expect(existsSync(join(oldRoot, 'documents', 'doc1'))).toBe(true)
    } finally {
      unlinkSync(aliasPath)
    }
  })

  it('uses the canonical spelling for a symlinked destination throughout the move', async () => {
    seedOldLocationDb()
    const realDestination = makeEmptyTempDir()
    const aliasPath = join(tmpdir(), `applyer-storage-destination-alias-${process.pid}-${Date.now()}`)
    symlinkSync(realDestination, aliasPath, 'dir')
    try {
      const result = await migrateStorageLocation(aliasPath)

      expect(result).toEqual({ ok: true })
      expect(activeStorageRoot()).toBe(realDestination)
      expect(readStorageLocationPointer().pointer.customRoot).toBe(realDestination)
      const row = dbModule.getDb().select().from(documents).where(eq(documents.id, 'doc1')).get()
      expect(row?.storedPath).toBe(join(realDestination, 'documents', 'doc1'))
    } finally {
      unlinkSync(aliasPath)
    }
  })

  it('queues a concurrent document write instead of losing it, landing it at the new location after commit', async () => {
    seedOldLocationDb()
    // Register the seeded file as the live db/index.ts connection so
    // addDocument's getDb() calls resolve against it, same as production.
    dbModule.openDatabaseAt(dbModule.dbPath(), { runMigrations: false })
    const dest = makeEmptyTempDir()

    // Not awaited: migrateStorageLocation acquires the storage write lock
    // synchronously (before its first await), so this addDocument call —
    // issued immediately after, however many of its own awaits precede its
    // own lock acquisition — is guaranteed to queue behind it rather than
    // race it.
    const migration = migrateStorageLocation(dest)
    const added = addDocument({
      kind: 'resume',
      originalFilename: 'late.txt',
      mimeType: 'text/plain',
      data: Buffer.from('late upload')
    })

    const migrationResult = await migration
    expect(migrationResult).toEqual({ ok: true })

    const addedDoc = await added
    // The write only ran once the lock released post-commit, so it must
    // have landed at the NEW location, not been dropped or written to the
    // now-deleted old one.
    expect(activeStorageRoot()).toBe(dest)
    expect(readDocumentBytes(addedDoc.id)?.toString('utf-8')).toBe('late upload')
    expect(existsSync(join(dest, 'documents', addedDoc.id))).toBe(true)
  })

  it('includes a log append that lands after the asynchronous log copy', async () => {
    seedOldLocationDb()
    const oldLogPath = join(logsDir(), 'race.log')
    writeFileSync(oldLogPath, 'before\n')
    const dest = makeEmptyTempDir()
    const originalCp = fsPromises.cp.bind(fsPromises)
    const cpSpy = vi.spyOn(fsPromises, 'cp').mockImplementation(async (...args) => {
      await originalCp(...args)
      if (args[0] === logsDir()) appendFileSync(oldLogPath, 'late\n')
    })

    const result = await migrateStorageLocation(dest)

    expect(result).toEqual({ ok: true })
    expect(readFileSync(join(dest, 'logs', 'race.log'), 'utf-8')).toBe('before\nlate\n')
    cpSpy.mockRestore()
  })

  it('rewrites jobs.screenshot_path alongside documents.storedPath', async () => {
    seedOldLocationDb()
    const sqlite = new Database(dbModule.dbPath())
    const db = drizzle(sqlite, { schema: { jobs } })
    const oldShotPath = join(screenshotsDir(), 'job1.png')
    writeFileSync(oldShotPath, 'fake-png-bytes')
    db.insert(jobs)
      .values({
        id: 'job1',
        title: 'Engineer',
        company: 'Acme',
        url: 'https://acme.example/1',
        status: 'filled',
        screenshotPath: oldShotPath
      })
      .run()
    sqlite.close()

    const dest = makeEmptyTempDir()
    const result = await migrateStorageLocation(dest)
    expect(result).toEqual({ ok: true })

    const row = dbModule.getDb().select().from(jobs).where(eq(jobs.id, 'job1')).get()
    expect(row?.screenshotPath).toBe(join(dest, 'screenshots', 'job1.png'))
  })

  it('allows a new call once a previous one has finished', async () => {
    seedOldLocationDb()
    const destA = makeEmptyTempDir()
    const destB = makeEmptyTempDir()

    const firstResult = await migrateStorageLocation(destA)
    expect(firstResult).toEqual({ ok: true })

    const secondResult = await migrateStorageLocation(destB)
    expect(secondResult).toEqual({ ok: true })
    expect(activeStorageRoot()).toBe(destB)
  })
})

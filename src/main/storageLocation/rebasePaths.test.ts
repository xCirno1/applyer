import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { join } from 'path'
import { createTestDb } from '../db/testDb'
import type * as schema from '../db/schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../db', () => ({ getDb: () => testDb }))

import { documents, jobs, profile } from '../db/schema'
import { fileNameOf, rebaseStoredPaths } from './rebasePaths'

const NEW_ROOT = join('/new', 'root')

beforeEach(() => {
  testDb = createTestDb().db
  const now = '2026-01-01T00:00:00.000Z'
  testDb.insert(profile).values({ id: 1, remotePreference: 'no_preference', createdAt: now, updatedAt: now }).run()
})

function addDocument(id: string, storedPath: string): void {
  testDb
    .insert(documents)
    .values({
      id,
      profileId: 1,
      kind: 'resume',
      originalFilename: 'resume.pdf',
      storedPath,
      mimeType: 'application/pdf',
      sizeBytes: 10,
      isEncryptedAtRest: false,
      createdAt: '2026-01-01T00:00:00.000Z'
    })
    .run()
}

function addJob(id: string, screenshotPath: string | null, screenshotPaths: string[] = []): void {
  const now = '2026-01-01T00:00:00.000Z'
  testDb
    .insert(jobs)
    .values({
      id,
      title: 'Engineer',
      company: 'Acme',
      url: `https://example.com/${id}`,
      status: 'filled',
      screenshotPath,
      screenshotPaths,
      queuedAt: now,
      createdAt: now,
      updatedAt: now
    })
    .run()
}

const storedPathOf = (id: string): string | undefined =>
  testDb.select().from(documents).all().find((row) => row.id === id)?.storedPath

const screenshotPathOf = (id: string): string | null | undefined =>
  testDb.select().from(jobs).all().find((row) => row.id === id)?.screenshotPath

const screenshotPathsOf = (id: string): string[] | undefined =>
  testDb.select().from(jobs).all().find((row) => row.id === id)?.screenshotPaths

describe('fileNameOf', () => {
  it('reads the last segment of a POSIX path', () => {
    expect(fileNameOf('/home/me/.applyer/documents/abc-123')).toBe('abc-123')
  })

  // The whole point: the database being connected to may have been written on
  // another platform, where the separator is not this one.
  it('reads the last segment of a Windows path on any platform', () => {
    expect(fileNameOf('C:\\Users\\me\\Applyer\\documents\\abc-123')).toBe('abc-123')
    expect(fileNameOf('C:/Users/me/Applyer/documents/abc-123')).toBe('abc-123')
  })

  it('returns a bare name unchanged', () => {
    expect(fileNameOf('abc-123')).toBe('abc-123')
  })

  it('keeps the extension, which a screenshot name carries', () => {
    expect(fileNameOf('/old/screenshots/job-1.png')).toBe('job-1.png')
  })
})

describe('rebaseStoredPaths', () => {
  it('points a document at the root that is actually open', () => {
    addDocument('doc-1', join('/old', 'root', 'documents', 'doc-1'))

    const result = rebaseStoredPaths(NEW_ROOT)

    expect(storedPathOf('doc-1')).toBe(join(NEW_ROOT, 'documents', 'doc-1'))
    expect(result.documents).toBe(1)
  })

  it('points a screenshot at the root that is actually open', () => {
    addJob('job-1', join('/old', 'root', 'screenshots', 'job-1.png'))

    const result = rebaseStoredPaths(NEW_ROOT)

    expect(screenshotPathOf('job-1')).toBe(join(NEW_ROOT, 'screenshots', 'job-1.png'))
    expect(result.screenshots).toBe(1)
  })

  it('rebases every screenshot for a multi-page form', () => {
    addJob(
      'job-1',
      join('/old', 'root', 'screenshots', 'job-1-2.png'),
      [join('/old', 'root', 'screenshots', 'job-1.png'), join('/old', 'root', 'screenshots', 'job-1-2.png')]
    )

    rebaseStoredPaths(NEW_ROOT)

    expect(screenshotPathsOf('job-1')).toEqual([
      join(NEW_ROOT, 'screenshots', 'job-1.png'),
      join(NEW_ROOT, 'screenshots', 'job-1-2.png')
    ])
  })

  it('rebases a path written on another platform', () => {
    addDocument('doc-1', 'C:\\Users\\me\\Applyer\\documents\\doc-1')

    rebaseStoredPaths(NEW_ROOT)

    expect(storedPathOf('doc-1')).toBe(join(NEW_ROOT, 'documents', 'doc-1'))
  })

  // The ordinary case — connecting to the location the app already used — must
  // not report work it did not do.
  it('leaves rows that already point at this root untouched', () => {
    addDocument('doc-1', join(NEW_ROOT, 'documents', 'doc-1'))
    addJob('job-1', join(NEW_ROOT, 'screenshots', 'job-1.png'))

    expect(rebaseStoredPaths(NEW_ROOT)).toEqual({ documents: 0, screenshots: 0 })
    expect(storedPathOf('doc-1')).toBe(join(NEW_ROOT, 'documents', 'doc-1'))
  })

  it('keeps the stored file name rather than deriving one from the row id', () => {
    // An imported bundle can carry a screenshot name written by another build.
    addJob('job-1', join('/old', 'screenshots', 'some-other-name.png'))

    rebaseStoredPaths(NEW_ROOT)

    expect(screenshotPathOf('job-1')).toBe(join(NEW_ROOT, 'screenshots', 'some-other-name.png'))
  })

  it('leaves jobs without a screenshot alone', () => {
    addJob('job-1', null)

    expect(rebaseStoredPaths(NEW_ROOT).screenshots).toBe(0)
    expect(screenshotPathOf('job-1')).toBeNull()
  })

  it('rebases every row, not just the first', () => {
    addDocument('doc-1', join('/old', 'documents', 'doc-1'))
    addDocument('doc-2', join('/elsewhere', 'documents', 'doc-2'))
    addJob('job-1', join('/old', 'screenshots', 'job-1.png'))
    addJob('job-2', join('/old', 'screenshots', 'job-2.png'))

    expect(rebaseStoredPaths(NEW_ROOT)).toEqual({ documents: 2, screenshots: 2 })
    expect(storedPathOf('doc-2')).toBe(join(NEW_ROOT, 'documents', 'doc-2'))
    expect(screenshotPathOf('job-2')).toBe(join(NEW_ROOT, 'screenshots', 'job-2.png'))
  })

  it('is idempotent — a second pass finds nothing left to do', () => {
    addDocument('doc-1', join('/old', 'documents', 'doc-1'))
    rebaseStoredPaths(NEW_ROOT)

    expect(rebaseStoredPaths(NEW_ROOT)).toEqual({ documents: 0, screenshots: 0 })
  })

  it('does nothing on an empty database', () => {
    expect(rebaseStoredPaths(NEW_ROOT)).toEqual({ documents: 0, screenshots: 0 })
  })
})

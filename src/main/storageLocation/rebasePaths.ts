import { join } from 'path'
import { eq, isNotNull } from 'drizzle-orm'
import { getDb } from '../db'
import { documents, jobs } from '../db/schema'

/**
 * Points the two absolute-path columns at the storage root that is actually
 * open.
 *
 * `documents.stored_path` and `jobs.screenshot_path` hold absolute paths, so
 * they only stay correct while the database sits where it sat when they were
 * written. `migrateStorageLocation` knows both roots and rewrites them as part
 * of the move — but *connecting* to an existing location does not have that
 * information, and it is the one flow where the paths are most likely already
 * wrong: the reason to point Applyer at a folder it did not create is that the
 * folder came from somewhere else (another machine, a synced drive, a manual
 * move). Without this, every document in it reads back as `null` from
 * `readDocumentBytes` — silently, since a missing file is indistinguishable
 * from a deleted one — and `fill_application` uploads no resume.
 *
 * Only the directory is rebased; the file name is kept exactly as stored.
 * Names are *usually* derivable (a document's file is its id, a screenshot is
 * `<jobId>.png`), but an imported bundle can carry a `screenshotPath` written
 * by another build, and a rule that reconstructs the name would quietly point
 * those rows at a file that never existed.
 */

/**
 * Last segment of a path written by *some* platform, not necessarily this one.
 *
 * `path.basename` splits on the separator of the running platform, so on POSIX
 * it reads all of `C:\Users\me\documents\abc` as a single name. A database
 * connected from another machine is exactly the case this function exists for,
 * so both separators count.
 */
export function fileNameOf(storedPath: string): string {
  const lastSeparator = Math.max(storedPath.lastIndexOf('/'), storedPath.lastIndexOf('\\'))
  return lastSeparator === -1 ? storedPath : storedPath.slice(lastSeparator + 1)
}

export interface RebaseResult {
  documents: number
  screenshots: number
}

/**
 * `root` is passed rather than read from `activeStorageRoot()` because this
 * runs *during* a switch: the database at the new root is already open, but
 * the active root only flips once every step has succeeded.
 */
export function rebaseStoredPaths(root: string): RebaseResult {
  const db = getDb()
  const documentsDir = join(root, 'documents')
  const screenshotsDir = join(root, 'screenshots')
  const result: RebaseResult = { documents: 0, screenshots: 0 }

  for (const row of db.select({ id: documents.id, storedPath: documents.storedPath }).from(documents).all()) {
    const expected = join(documentsDir, fileNameOf(row.storedPath))
    if (expected === row.storedPath) continue
    db.update(documents).set({ storedPath: expected }).where(eq(documents.id, row.id)).run()
    result.documents += 1
  }

  const jobRows = db
    .select({ id: jobs.id, screenshotPath: jobs.screenshotPath })
    .from(jobs)
    .where(isNotNull(jobs.screenshotPath))
    .all()

  for (const row of jobRows) {
    // Narrowing only: the query already excludes nulls.
    if (!row.screenshotPath) continue
    const expected = join(screenshotsDir, fileNameOf(row.screenshotPath))
    if (expected === row.screenshotPath) continue
    db.update(jobs).set({ screenshotPath: expected }).where(eq(jobs.id, row.id)).run()
    result.screenshots += 1
  }

  return result
}

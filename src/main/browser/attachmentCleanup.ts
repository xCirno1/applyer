import { dirname, resolve } from 'path'
import { rmSync, unlinkSync } from 'fs'
import { tempDir } from '../config/paths'

/*
 * Best-effort removal of the short-lived files a fill leaves behind: the
 * decrypted documents handed to a file input, and screenshots a multi-step
 * flow has moved past.
 *
 * Rendered resumes are the one case that owns a directory: each render gets
 * its own folder under the temp root so the PDF can carry a human-looking
 * name. That folder is removed with the file, but only when it really is a
 * direct child of the temp root. Anything else (an original upload written
 * straight into the temp root, a screenshot in the storage root) loses just
 * the file, since its parent holds other jobs' files too.
 */

/** Removes one file; a missing file or a failed unlink is not an error. */
export function removeFile(path: string | undefined): void {
  if (!path) return
  try {
    unlinkSync(path)
  } catch {
    // Best-effort cleanup of a short-lived file.
  }
}

/** Removes a materialized document and, for a rendered resume, its per-render folder. */
export function removeMaterializedDocument(path: string | undefined, root: string = tempDir()): void {
  if (!path) return
  removeFile(path)
  const parent = resolve(dirname(path))
  if (dirname(parent) !== resolve(root)) return
  try {
    rmSync(parent, { recursive: true, force: true })
  } catch {
    // An empty folder left in the temp dir is harmless.
  }
}

/**
 * Serializes callers against a single shared promise chain. Used to make the
 * storage-location migration's copy-snapshot-commit critical section
 * mutually exclusive with the handful of operations that write a file
 * referenced by an absolute DB path or resolved by convention against the
 * active storage root — addDocument, deleteDocument,
 * rewriteDocumentStorageMode, and a filled job's screenshot capture.
 *
 * Without this, a write landing between the migration's directory copy and
 * its DB snapshot can be silently lost: the file (or its absence) and the DB
 * row end up disagreeing, and the migration's old-location cleanup then
 * deletes whichever side was left behind. Queuing instead of dropping means
 * such a write simply resolves after the migration finishes, against the
 * now-active new location — nothing is lost, it's just briefly delayed.
 */
let chain: Promise<unknown> = Promise.resolve()

export function withStorageWriteLock<T>(fn: () => Promise<T> | T): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

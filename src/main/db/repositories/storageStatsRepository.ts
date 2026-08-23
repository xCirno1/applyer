import { sql } from 'drizzle-orm'
import { getDb } from '../index'
import { jobs, indexedJobs, jobExclusions, documents, activityLog } from '../schema'

export interface StorageRowCounts {
  jobs: number
  indexedJobs: number
  exclusions: number
  documents: number
  activityLogEntries: number
}

export function getStorageRowCounts(): StorageRowCounts {
  const db = getDb()
  const count = (table: typeof jobs | typeof indexedJobs | typeof jobExclusions | typeof documents | typeof activityLog): number =>
    db.select({ count: sql<number>`count(*)` }).from(table).get()?.count ?? 0

  return {
    jobs: count(jobs),
    indexedJobs: count(indexedJobs),
    exclusions: count(jobExclusions),
    documents: count(documents),
    activityLogEntries: count(activityLog)
  }
}

import { sql } from 'drizzle-orm'
import { getDb } from '../index'
import { jobs, indexedJobs, jobExclusions, companyBoards, documents, activityLog } from '../schema'

export interface StorageRowCounts {
  jobs: number
  indexedJobs: number
  exclusions: number
  companyBoards: number
  documents: number
  activityLogEntries: number
}

export function getStorageRowCounts(): StorageRowCounts {
  const db = getDb()
  const count = (
    table: typeof jobs | typeof indexedJobs | typeof jobExclusions | typeof companyBoards | typeof documents | typeof activityLog
  ): number =>
    db.select({ count: sql<number>`count(*)` }).from(table).get()?.count ?? 0

  return {
    jobs: count(jobs),
    indexedJobs: count(indexedJobs),
    exclusions: count(jobExclusions),
    companyBoards: count(companyBoards),
    documents: count(documents),
    activityLogEntries: count(activityLog)
  }
}

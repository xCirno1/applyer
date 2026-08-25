import { join } from 'path'
import { readdirSync, statSync, type Dirent } from 'fs'
import { documentsDir, screenshotsDir, logsDir } from './config/paths'
import { getStorageRowCounts } from './db/repositories/storageStatsRepository'
import { dbPath } from './db'
import type { StorageStats } from '@shared/types/storage'

function fileSizeOrZero(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

function dirSizeBytes(dir: string): number {
  let total = 0
  let entries: Dirent<string>[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      total += dirSizeBytes(path)
    } else if (entry.isFile()) {
      total += fileSizeOrZero(path)
    }
  }
  return total
}

function databaseSizeBytes(): number {
  const path = dbPath()
  // WAL journal mode keeps recent writes in -wal/-shm sidecar files rather
  // than the main file until a checkpoint, so all three must be summed to
  // reflect what's actually on disk.
  return fileSizeOrZero(path) + fileSizeOrZero(`${path}-wal`) + fileSizeOrZero(`${path}-shm`)
}

export function computeStorageStats(): StorageStats {
  const breakdown = [
    { key: 'database' as const, label: 'Database', bytes: databaseSizeBytes() },
    { key: 'documents' as const, label: 'Documents', bytes: dirSizeBytes(documentsDir()) },
    { key: 'screenshots' as const, label: 'Screenshots', bytes: dirSizeBytes(screenshotsDir()) },
    { key: 'logs' as const, label: 'Logs', bytes: dirSizeBytes(logsDir()) }
  ]

  return {
    totalBytes: breakdown.reduce((sum, item) => sum + item.bytes, 0),
    breakdown,
    counts: getStorageRowCounts()
  }
}

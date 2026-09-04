export interface StorageBreakdownItem {
  key: 'database' | 'documents' | 'screenshots' | 'logs'
  label: string
  bytes: number
}

export interface StorageStats {
  totalBytes: number
  breakdown: StorageBreakdownItem[]
  counts: {
    jobs: number
    indexedJobs: number
    exclusions: number
    companyBoards: number
    documents: number
    activityLogEntries: number
  }
}

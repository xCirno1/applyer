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
    resumeVariants: number
    activityLogEntries: number
    chatSessions: number
    chatMessages: number
  }
}

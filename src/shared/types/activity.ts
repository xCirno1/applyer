export type ActivityLevel = 'debug' | 'info' | 'warn' | 'error'

export interface ActivityLogEntry {
  id: number
  jobId: string | null
  level: ActivityLevel
  message: string
  meta: Record<string, unknown> | null
  createdAt: string
}

export interface ListActivityQuery {
  jobId?: string
  level?: ActivityLevel
  limit?: number
  offset?: number
}

export interface ListActivityResult {
  entries: ActivityLogEntry[]
  total: number
}

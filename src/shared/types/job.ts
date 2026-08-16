export type JobStatus = 'queued' | 'filled' | 'submitted' | 'failed'

export type ApplyMethod = 'external_form' | 'easy_apply' | 'email' | 'unknown'

export interface JobRecord {
  id: string
  externalId: string | null
  source: string | null
  title: string
  company: string
  location: string | null
  url: string
  description: string | null
  salaryRange: string | null
  status: JobStatus
  matchScore: number | null
  matchReasons: string[] | null
  applicationUrl: string | null
  applyMethod: ApplyMethod | null
  screenshotPath: string | null
  failureTag: string | null
  failureMessage: string | null
  blockingReason: string | null
  blockingTaskId: string | null
  queuedAt: string
  filledAt: string | null
  submittedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface FailureTag {
  id: string
  label: string
  description: string | null
  isBuiltin: boolean
}

export type JobSortOrder = 'newest' | 'matchScore'

export interface ListJobsQuery {
  status?: JobStatus
  limit?: number
  offset?: number
  search?: string
  source?: string
  sortBy?: JobSortOrder
}

export interface ListJobsResult {
  jobs: JobRecord[]
  total: number
}

import type { JobAttachedResume } from '../resume/attachedResume'

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
  /** Ordered screenshots for every retained application step. */
  screenshotPaths: string[]
  failureTag: string | null
  failureMessage: string | null
  blockingReason: string | null
  blockingTaskId: string | null
  queuedAt: string
  filledAt: string | null
  submittedAt: string | null
  /** The named resume variant this job attaches (see `shared/types/resume.ts`); null means the fallback (master or original upload). */
  resumeVariantId: string | null
  /** Which resume the application actually got, recorded when the form accepted the file; null until one was attached (and again after a retry starts a fresh application). */
  attachedResume: JobAttachedResume | null
  /**
   * The post-submission stage (see `shared/types/applicationStage.ts`); only
   * ever set on a Submitted job. An id no stage has any more is read as "no
   * stage" by every consumer, never as an error.
   */
  stageId: string | null
  /** When `stageId` last changed; null until a stage is first set. */
  stageChangedAt: string | null
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
  /**
   * Narrows to one post-submission stage: a stage id, or `null` for jobs with
   * no stage. Left out, every stage is listed. Only meaningful alongside
   * `status: 'submitted'`, since no other status carries a stage.
   */
  stageId?: string | null
}

export interface ListJobsResult {
  jobs: JobRecord[]
  total: number
}

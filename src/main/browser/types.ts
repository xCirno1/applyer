import type { JobSource } from './sourceRouter'
import type { ApplyMethod } from '@shared/types/job'

export interface JobSearchResultItem {
  title: string
  company: string
  location?: string
  url: string
  source: JobSource
  postedAt?: string
  snippet: string
  salaryRange?: string
}

export interface JobDetailsData {
  title: string
  company: string
  location?: string
  /** Sanitized HTML, safe to render. */
  description: string
  /** Plain-text extraction of the same content, for agent consumption. */
  descriptionText: string
  requirements?: string[]
  applicationUrl: string
  detectedAts?: string
  requiresLogin: boolean
  applyMethod: ApplyMethod
  salaryRange?: string
}

export type JobDetailsOutcome =
  | { status: 'ok'; details: JobDetailsData }
  | { status: 'blocked'; reasonTag: string; message: string }
  | { status: 'not_found'; message: string }

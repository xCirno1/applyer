import { z } from 'zod'

const jobSourceEnum = z.enum(['greenhouse', 'lever', 'ashby', 'workday', 'linkedin', 'indeed', 'generic'])
const jobStatusEnum = z.enum(['queued', 'filled', 'submitted', 'failed'])

export const searchJobsShape = {
  query: z.string().trim().min(1).max(200),
  location: z.string().trim().max(200).optional(),
  remote: z.boolean().optional(),
  jobType: z.enum(['full_time', 'part_time', 'contract', 'internship']).optional(),
  sources: z.array(jobSourceEnum).optional(),
  limit: z.number().int().min(1).max(50).optional()
}

export const getJobDetailsShape = {
  url: z.string().trim().url()
}

export const queueJobShape = {
  title: z.string().trim().min(1).max(300),
  company: z.string().trim().min(1).max(300),
  url: z.string().trim().url(),
  location: z.string().trim().max(300).optional(),
  source: z.string().trim().max(50).optional(),
  description: z.string().max(50000).optional(),
  salaryRange: z.string().trim().max(200).optional(),
  matchScore: z.number().int().min(0).max(100).optional(),
  matchReasons: z.array(z.string().trim().max(200)).max(5).optional()
}

export const listJobsShape = {
  status: jobStatusEnum.optional(),
  limit: z.number().int().min(1).max(50).optional(),
  offset: z.number().int().min(0).optional()
}

export const flagFailureShape = {
  jobId: z.string().trim().min(1),
  reasonTag: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,39}$/, 'reasonTag must be lowercase snake_case, 2-40 chars'),
  message: z.string().trim().max(500).optional()
}

export const getProfileShape = {}

export const fillApplicationShape = {
  jobId: z.string().trim().min(1)
}

export const excludeJobShape = {
  url: z.string().trim().url(),
  title: z.string().trim().max(300).optional(),
  company: z.string().trim().max(300).optional(),
  reason: z.string().trim().max(300).optional()
}

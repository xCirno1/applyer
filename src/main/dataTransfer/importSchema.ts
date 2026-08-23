import { z } from 'zod'
import { EXPORT_SCHEMA_VERSION, type ExportBundle } from '@shared/types/dataTransfer'

const jobStatusSchema = z.enum(['queued', 'filled', 'submitted', 'failed'])
const applyMethodSchema = z.enum(['external_form', 'easy_apply', 'email', 'unknown'])

const jobRecordSchema = z.object({
  id: z.string(),
  externalId: z.string().nullable(),
  source: z.string().nullable(),
  title: z.string().min(1),
  company: z.string().min(1),
  location: z.string().nullable(),
  url: z.string().min(1),
  description: z.string().nullable(),
  salaryRange: z.string().nullable(),
  status: jobStatusSchema,
  matchScore: z.number().nullable(),
  matchReasons: z.array(z.string()).nullable(),
  applicationUrl: z.string().nullable(),
  applyMethod: applyMethodSchema.nullable(),
  screenshotPath: z.string().nullable(),
  failureTag: z.string().nullable(),
  failureMessage: z.string().nullable(),
  blockingReason: z.string().nullable(),
  blockingTaskId: z.string().nullable(),
  queuedAt: z.string(),
  filledAt: z.string().nullable(),
  submittedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
})

const exclusionRecordSchema = z.object({
  id: z.string(),
  url: z.string().min(1),
  title: z.string().nullable(),
  company: z.string().nullable(),
  reason: z.string().nullable(),
  excludedBy: z.enum(['user', 'agent']),
  createdAt: z.string()
})

const profileFieldsSchema = z.object({
  fullName: z.string(),
  email: z.string(),
  phone: z.string(),
  location: z.string(),
  linkedinUrl: z.string(),
  githubUrl: z.string(),
  portfolioUrl: z.string(),
  workAuthorization: z.string(),
  desiredRoles: z.array(z.string()),
  desiredLocations: z.array(z.string()),
  remotePreference: z.enum(['remote', 'hybrid', 'onsite', 'no_preference']),
  salaryMin: z.number().nullable(),
  salaryMax: z.number().nullable(),
  salaryCurrency: z.string(),
  yearsExperience: z.number().nullable(),
  summary: z.string(),
  skills: z.array(z.string())
})

const settingsDataSchema = z.object({
  autoStartCommand: z.string(),
  indexedJobsRetentionDays: z.union([z.number().int().positive(), z.literal('unlimited')])
})

const exportBundleSchema = z.object({
  schemaVersion: z.literal(EXPORT_SCHEMA_VERSION),
  exportedAt: z.string(),
  appVersion: z.string(),
  data: z.object({
    jobs: z.array(jobRecordSchema).optional(),
    exclusions: z.array(exclusionRecordSchema).optional(),
    profile: profileFieldsSchema.nullable().optional(),
    settings: settingsDataSchema.optional()
  })
})

export type ValidateBundleResult = { ok: true; bundle: ExportBundle } | { ok: false; error: string }

/**
 * Import is round-trip only — the sole accepted input is a file this app
 * itself produced, so a failed parse here almost always means "wrong file"
 * rather than "different but valid data source", and gets a single generic
 * message rather than a field-by-field diagnostic.
 */
export function validateExportBundle(raw: unknown): ValidateBundleResult {
  const result = exportBundleSchema.safeParse(raw)
  if (!result.success) {
    return { ok: false, error: 'This file is not a valid Applyer export.' }
  }
  return { ok: true, bundle: result.data }
}

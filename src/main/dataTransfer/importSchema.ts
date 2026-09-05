import { z } from 'zod'
import { EXPORT_SCHEMA_VERSION, type ExportBundle } from '@shared/types/dataTransfer'
import { isAtsProvider, type AtsProvider } from '@shared/types/companyBoard'
import { isValidBoardDescriptor } from '../browser/ats/providers'
import { appError, type AppError } from '@shared/types/errorCodes'
import {
  isValidCanvasTint,
  isValidHexColor,
  MAX_CSS_PRESETS,
  MAX_CUSTOM_CSS_LENGTH,
  MAX_PRESET_NAME_LENGTH
} from '@shared/types/theme'

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

/**
 * `id` is absent by design — it is minted on import, since an indexed job's
 * identity is its URL. `seenCount` is bounded rather than trusted: it is
 * rendered per row, and a file is whatever someone made it.
 */
const indexedJobSchema = z.object({
  url: z.string().min(1),
  title: z.string().min(1),
  company: z.string().min(1),
  location: z.string().nullable(),
  source: z.string().nullable(),
  snippet: z.string().nullable(),
  salaryRange: z.string().nullable(),
  postedAt: z.string().nullable(),
  searchQuery: z.string(),
  searchLocation: z.string().nullable(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  seenCount: z.number().int().positive()
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

/**
 * `boardKey` is absent by design — it is derived from the four fields above
 * it and is recomputed on import, so a file cannot assert an identity that
 * contradicts its own descriptor. The last-fetch columns are absent for the
 * same reason they aren't exported: they describe another machine's reading.
 */
const companyBoardSchema = z
  .object({
    // Delegated to the shared guard rather than restating the four names, so a
    // provider added later can't be accepted by the schema while the rest of
    // the app has no adapter for it (or the reverse).
    provider: z.custom<AtsProvider>(isAtsProvider),
    token: z.string().min(1),
    host: z.string().nullable(),
    site: z.string().nullable(),
    companyName: z.string().min(1),
    addedBy: z.enum(['user', 'agent']),
    enabled: z.boolean(),
    // A claim from a feed, so it is bounded like any other imported number
    // rather than trusted: a negative or fractional "size" would order sweeps
    // by a value no board can have.
    seedJobCount: z.number().int().nonnegative().nullable().optional(),
    createdAt: z.string()
  })
  // A bundle is a file, and `host` is the only imported value that becomes
  // the *authority* of an outbound request: the Workday adapter posts to it,
  // and Lever picks its region from it. Without this, importing a crafted
  // bundle and running one search would send a request to a host of the
  // file's choosing. `isValidBoardDescriptor` is the same rule the adapters
  // enforce again at the point of use.
  .refine(isValidBoardDescriptor)

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
  indexedJobsRetentionDays: z.union([z.number().int().positive(), z.literal('unlimited')]),
  notificationPreferences: z
    .object({
      enabled: z.boolean(),
      verificationRequired: z.boolean(),
      jobFilled: z.boolean(),
      jobFailed: z.boolean()
    })
    .optional()
})

/**
 * Mirrors the bounds `renderer/src/theme/theme.ts`'s `parseThemeState`
 * enforces on this same shape when reading localStorage, via the shared
 * constants both sides import — this domain is exactly as untrusted as that
 * one. Cross-field consistency (e.g. `activePresetId` actually naming one of
 * `presets`) is deliberately not re-checked here: `parseThemeState` runs
 * again when the renderer actually applies an imported theme (see
 * `ThemeContext.importTheme`), so a bundle that passes this shape check but
 * fails that cross-check just has its `activePresetId` reset to null there,
 * the same as it would from a hand-edited localStorage value.
 */
const cssPresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(MAX_PRESET_NAME_LENGTH),
  css: z.string().max(MAX_CUSTOM_CSS_LENGTH)
})

const themeStateSchema = z.object({
  mode: z.enum(['system', 'light', 'dark']),
  accent: z.string().refine(isValidHexColor).nullable(),
  canvasTint: z.number().refine(isValidCanvasTint).nullable(),
  customCss: z.string().max(MAX_CUSTOM_CSS_LENGTH),
  presets: z.array(cssPresetSchema).max(MAX_CSS_PRESETS),
  activePresetId: z.string().nullable()
})

const exportBundleSchema = z.object({
  schemaVersion: z.literal(EXPORT_SCHEMA_VERSION),
  exportedAt: z.string(),
  appVersion: z.string(),
  data: z.object({
    jobs: z.array(jobRecordSchema).optional(),
    indexedJobs: z.array(indexedJobSchema).optional(),
    exclusions: z.array(exclusionRecordSchema).optional(),
    companyBoards: z.array(companyBoardSchema).optional(),
    profile: profileFieldsSchema.nullable().optional(),
    settings: settingsDataSchema.optional(),
    theme: themeStateSchema.optional()
  })
})

export type ValidateBundleResult = { ok: true; bundle: ExportBundle } | { ok: false; error: AppError }

/**
 * Import is round-trip only — the sole accepted input is a file this app
 * itself produced, so a failed parse here almost always means "wrong file"
 * rather than "different but valid data source", and gets a single generic
 * message rather than a field-by-field diagnostic.
 */
export function validateExportBundle(raw: unknown): ValidateBundleResult {
  const result = exportBundleSchema.safeParse(raw)
  if (!result.success) {
    return { ok: false, error: appError('invalidExport') }
  }
  return { ok: true, bundle: result.data }
}

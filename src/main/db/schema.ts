import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

const nowIso = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})

export const profile = sqliteTable('profile', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fullName: text('full_name'),
  email: text('email'),
  phone: text('phone'),
  location: text('location'),
  linkedinUrl: text('linkedin_url'),
  githubUrl: text('github_url'),
  portfolioUrl: text('portfolio_url'),
  workAuthorization: text('work_authorization'),
  desiredRoles: text('desired_roles', { mode: 'json' }).$type<string[]>(),
  desiredLocations: text('desired_locations', { mode: 'json' }).$type<string[]>(),
  remotePreference: text('remote_preference', {
    enum: ['remote', 'hybrid', 'onsite', 'no_preference']
  }),
  salaryMin: integer('salary_min'),
  salaryMax: integer('salary_max'),
  salaryCurrency: text('salary_currency'),
  yearsExperience: integer('years_experience'),
  summary: text('summary'),
  skills: text('skills', { mode: 'json' }).$type<string[]>(),
  /** Version-tagged encrypted JSON containing every ProfileFields value. Legacy columns above are read only for migration. */
  securePayload: text('secure_payload'),
  createdAt: text('created_at').notNull().default(nowIso),
  updatedAt: text('updated_at').notNull().default(nowIso)
})

export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  profileId: integer('profile_id')
    .notNull()
    .references(() => profile.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['resume', 'cover_letter', 'other'] }).notNull(),
  originalFilename: text('original_filename').notNull(),
  storedPath: text('stored_path').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  extractedText: text('extracted_text'),
  isEncryptedAtRest: integer('is_encrypted_at_rest', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().default(nowIso)
})

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  externalId: text('external_id'),
  source: text('source'),
  title: text('title').notNull(),
  company: text('company').notNull(),
  location: text('location'),
  url: text('url').notNull().unique(),
  description: text('description'),
  salaryRange: text('salary_range'),
  status: text('status', { enum: ['queued', 'filled', 'submitted', 'failed'] })
    .notNull()
    .default('queued'),
  matchScore: integer('match_score'),
  matchReasons: text('match_reasons', { mode: 'json' }).$type<string[]>(),
  applicationUrl: text('application_url'),
  applyMethod: text('apply_method', {
    enum: ['external_form', 'easy_apply', 'email', 'unknown']
  }),
  screenshotPath: text('screenshot_path'),
  screenshotPaths: text('screenshot_paths', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
  failureTag: text('failure_tag'),
  failureMessage: text('failure_message'),
  blockingReason: text('blocking_reason'),
  blockingTaskId: text('blocking_task_id'),
  queuedAt: text('queued_at').notNull().default(nowIso),
  filledAt: text('filled_at'),
  submittedAt: text('submitted_at'),
  /**
   * The named resume variant this job's application attaches (see
   * `resumeVariants`); null means the master or the original upload,
   * whichever the fallback setting says. Cleared, not cascaded, when the
   * variant is deleted: the job is still a job, it just goes back to the
   * fallback. The reference is a lazy callback, so pointing at a table
   * declared further down is fine.
   */
  resumeVariantId: text('resume_variant_id').references(() => resumeVariants.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull().default(nowIso),
  updatedAt: text('updated_at').notNull().default(nowIso)
})

/**
 * The user's resume as structured content (see `shared/types/resume.ts`),
 * single row like `profile`. `secure_payload` is the field-encrypted JSON of
 * `ResumeContent`: whole-database encryption already covers the row, but a
 * resume is the most sensitive thing the app stores, so it gets the same
 * envelope as the profile. Template and page size stay as plain columns since
 * they carry nothing personal and the variant list reads them without
 * decrypting anything.
 */
export const resumeMaster = sqliteTable('resume_master', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  securePayload: text('secure_payload').notNull(),
  templateId: text('template_id').notNull().default('classic'),
  pageSize: text('page_size').notNull().default('letter'),
  /** JSON ResumeStyle (font family/size over the template); null means the template's own. */
  style: text('style'),
  /** No FK: the upload this was imported from may be deleted later without losing the master. */
  sourceDocumentId: text('source_document_id'),
  createdAt: text('created_at').notNull().default(nowIso),
  updatedAt: text('updated_at').notNull().default(nowIso)
})

/**
 * A named, reusable tailored copy of the master ("Backend-focused",
 * "Concise one-page"). A full copy of the content rather than a patch, so it
 * still renders after the master changes; the `based_on_master_updated_at`
 * stamp is what marks it stale when that happens. Jobs point at a variant
 * through `jobs.resume_variant_id` (many jobs, one variant), so deleting a
 * job never deletes a variant and deleting a variant only unassigns its
 * jobs. The name is unique case-insensitively, enforced in the repository;
 * the index here is the exact-match backstop.
 */
export const resumeVariants = sqliteTable(
  'resume_variants',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    securePayload: text('secure_payload').notNull(),
    templateId: text('template_id').notNull(),
    basedOnMasterUpdatedAt: text('based_on_master_updated_at').notNull(),
    createdAt: text('created_at').notNull().default(nowIso),
    updatedAt: text('updated_at').notNull().default(nowIso)
  },
  (table) => [uniqueIndex('resume_variants_name_unique').on(table.name)]
)

export const jobExclusions = sqliteTable('job_exclusions', {
  id: text('id').primaryKey(),
  url: text('url').notNull().unique(),
  title: text('title'),
  company: text('company'),
  reason: text('reason'),
  excludedBy: text('excluded_by', { enum: ['user', 'agent'] }).notNull(),
  createdAt: text('created_at').notNull().default(nowIso)
})

export const indexedJobs = sqliteTable('indexed_jobs', {
  id: text('id').primaryKey(),
  url: text('url').notNull().unique(),
  title: text('title').notNull(),
  company: text('company').notNull(),
  location: text('location'),
  source: text('source'),
  snippet: text('snippet'),
  salaryRange: text('salary_range'),
  postedAt: text('posted_at'),
  searchQuery: text('search_query').notNull(),
  searchLocation: text('search_location'),
  firstSeenAt: text('first_seen_at').notNull().default(nowIso),
  lastSeenAt: text('last_seen_at').notNull().default(nowIso),
  seenCount: integer('seen_count').notNull().default(1)
})

/**
 * Company ATS boards tracked as a search source.
 *
 * None of Greenhouse/Lever/Ashby/Workday has a cross-company search endpoint,
 * so "search these boards" means "fetch the boards of the companies in this
 * table and filter locally" — this list *is* that source's coverage.
 *
 * `boardKey` (`provider:token`, plus host and site for Workday) carries the
 * uniqueness rather than a composite index over the columns: SQLite treats
 * two NULLs as distinct, so an index over (provider, token, host, site) would
 * happily accept the same Greenhouse board twice.
 */
export const companyBoards = sqliteTable('company_boards', {
  id: text('id').primaryKey(),
  boardKey: text('board_key').notNull().unique(),
  provider: text('provider', { enum: ['greenhouse', 'lever', 'ashby', 'workday'] }).notNull(),
  token: text('token').notNull(),
  /** Workday only: the data-centre host its tenant is served from. */
  host: text('host'),
  /** Workday only: the career-site id. */
  site: text('site'),
  companyName: text('company_name').notNull(),
  addedBy: text('added_by', { enum: ['user', 'agent'] }).notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  lastCheckedAt: text('last_checked_at'),
  /** Postings on the last fetch. 0 is a real answer (a live board with nothing open); null means never fetched. */
  lastJobCount: integer('last_job_count'),
  /**
   * What the feed a board was imported from said it holds, or null when
   * nothing said. Never a reading of our own — `lastJobCount` is the only
   * column that speaks for a fetch — it exists so a watchlist that has never
   * been fetched can still be swept biggest-first (see
   * `browser/ats/boardSweep.ts`), and is ignored the moment a real fetch
   * measures the board.
   */
  seedJobCount: integer('seed_job_count'),
  lastError: text('last_error'),
  createdAt: text('created_at').notNull().default(nowIso)
})

export const failureTags = sqliteTable('failure_tags', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  description: text('description'),
  isBuiltin: integer('is_builtin', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().default(nowIso)
})

export const jobDetailsCache = sqliteTable('job_details_cache', {
  urlHash: text('url_hash').primaryKey(),
  url: text('url').notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
  // Which build of the scrapers produced `payload`. Rows written before this
  // column existed default to 0 and so never match the current version,
  // which is what retires them. See JOB_DETAILS_CACHE_PAYLOAD_VERSION.
  payloadVersion: integer('payload_version').notNull().default(0),
  detectedAts: text('detected_ats'),
  requiresLogin: integer('requires_login', { mode: 'boolean' }).notNull().default(false),
  applyMethod: text('apply_method'),
  fetchedAt: text('fetched_at').notNull().default(nowIso)
})

export const activityLog = sqliteTable('activity_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  jobId: text('job_id'),
  level: text('level', { enum: ['debug', 'info', 'warn', 'error'] })
    .notNull()
    .default('info'),
  message: text('message').notNull(),
  meta: text('meta', { mode: 'json' }),
  createdAt: text('created_at').notNull().default(nowIso)
})

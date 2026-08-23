import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
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
  failureTag: text('failure_tag'),
  failureMessage: text('failure_message'),
  blockingReason: text('blocking_reason'),
  blockingTaskId: text('blocking_task_id'),
  queuedAt: text('queued_at').notNull().default(nowIso),
  filledAt: text('filled_at'),
  submittedAt: text('submitted_at'),
  createdAt: text('created_at').notNull().default(nowIso),
  updatedAt: text('updated_at').notNull().default(nowIso)
})

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

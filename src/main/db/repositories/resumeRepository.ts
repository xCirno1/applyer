import { randomUUID } from 'crypto'
import { asc, desc, eq, isNotNull, sql } from 'drizzle-orm'
import { getDb } from '../index'
import { jobs, resumeMaster, resumeVariants } from '../schema'
import { readSecureField, writeSecureField } from '../encryption'
import { getStorageMode } from './settingsRepository'
import { getJob } from './jobsRepository'
import {
  isResumePageSize,
  isResumeTemplateId,
  normalizeResumeContent,
  normalizeResumeStyle,
  normalizeResumeVariantName,
  resumeVariantNameKey,
  type MasterResume,
  type ResumeContent,
  type ResumePageSize,
  type ResumeStyle,
  type ResumeTemplateId,
  type ResumeVariant,
  type ResumeVariantJobLink,
  type ResumeVariantSummary
} from '@shared/types/resume'
import type { StorageMode } from '@shared/types/profile'
import type { JobRecord } from '@shared/types/job'

/*
 * Storage for the master resume and its named variants. Content goes into
 * an encrypted envelope exactly like `profileRepository.saveProfile`: one
 * `writeSecureField(JSON.stringify(content), mode)` per row, with the mode
 * read at write time and never re-derived on read (the `enc:v1:` marker on
 * the stored value is what says whether to decrypt).
 *
 * Variants are independent of jobs: a job points at one through
 * `jobs.resume_variant_id`, and several jobs can point at the same one.
 * Names are the agent-facing and user-facing handle (unique
 * case-insensitively); ids are for the renderer.
 *
 * Callers never see a half-valid resume. A payload that fails to decrypt or
 * parse throws the same kind of "invalid or corrupted" error as the profile,
 * so the UI can say so instead of rendering an empty page as if the user had
 * written one.
 */

const MASTER_ID = 1

type MasterRow = typeof resumeMaster.$inferSelect
type VariantRow = typeof resumeVariants.$inferSelect

function currentMode(): StorageMode {
  // Fails closed: if a storage mode was somehow never chosen, default to the
  // more protective option rather than silently writing plaintext.
  return getStorageMode() ?? 'encrypted'
}

function decodeContent(payload: string, what: string): ResumeContent {
  const serialized = readSecureField(payload)
  if (!serialized) throw new Error(`The encrypted ${what} payload was empty.`)
  let parsed: unknown
  try {
    parsed = JSON.parse(serialized)
  } catch {
    throw new Error(`The stored ${what} payload is invalid or corrupted.`)
  }
  const content = normalizeResumeContent(parsed)
  if (!content) throw new Error(`The stored ${what} payload is invalid or corrupted.`)
  return content
}

function encodeContent(content: ResumeContent, mode: StorageMode): string {
  const encoded = writeSecureField(JSON.stringify(content), mode)
  if (!encoded) throw new Error('Failed to encode resume content.')
  return encoded
}

/** Plain columns are not trusted either: a hand-edited database must not crash the template lookup. */
function templateOf(value: string): ResumeTemplateId {
  return isResumeTemplateId(value) ? value : 'classic'
}

function pageSizeOf(value: string): ResumePageSize {
  return isResumePageSize(value) ? value : 'letter'
}

/** The style column is plain JSON (nothing personal in a font choice); a bad value means template defaults, not a crash. */
function styleOf(value: string | null): ResumeStyle {
  if (!value) return {}
  try {
    return normalizeResumeStyle(JSON.parse(value))
  } catch {
    return {}
  }
}

function toMaster(row: MasterRow): MasterResume {
  return {
    content: decodeContent(row.securePayload, 'master resume'),
    templateId: templateOf(row.templateId),
    pageSize: pageSizeOf(row.pageSize),
    style: styleOf(row.style),
    sourceDocumentId: row.sourceDocumentId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

function toVariant(row: VariantRow): ResumeVariant {
  return {
    id: row.id,
    name: row.name,
    content: decodeContent(row.securePayload, 'resume variant'),
    templateId: templateOf(row.templateId),
    basedOnMasterUpdatedAt: row.basedOnMasterUpdatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

function masterRow(): MasterRow | undefined {
  return getDb().select().from(resumeMaster).where(eq(resumeMaster.id, MASTER_ID)).get()
}

export function hasMasterResume(): boolean {
  return masterRow() !== undefined
}

export function getMasterResume(): MasterResume | null {
  const row = masterRow()
  return row ? toMaster(row) : null
}

export interface SaveMasterResumeInput {
  content: ResumeContent
  templateId?: ResumeTemplateId
  pageSize?: ResumePageSize
  /** Replaces the whole style when given (an empty object returns to template defaults). */
  style?: ResumeStyle
  /** `undefined` keeps the stored value; `null` clears it. */
  sourceDocumentId?: string | null
}

/**
 * Upsert of the single master row. Every save bumps `updatedAt`, which is
 * what turns existing variants stale, so a save that changes only the
 * template still marks them: the rendered output did change.
 */
export function saveMasterResume(input: SaveMasterResumeInput): MasterResume {
  const db = getDb()
  const existing = masterRow()
  const now = new Date().toISOString()
  const values = {
    id: MASTER_ID,
    securePayload: encodeContent(input.content, currentMode()),
    templateId: input.templateId ?? (existing ? templateOf(existing.templateId) : 'classic'),
    pageSize: input.pageSize ?? (existing ? pageSizeOf(existing.pageSize) : 'letter'),
    style: input.style ? JSON.stringify(normalizeResumeStyle(input.style)) : (existing?.style ?? null),
    sourceDocumentId:
      input.sourceDocumentId === undefined ? (existing?.sourceDocumentId ?? null) : input.sourceDocumentId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  }
  db.insert(resumeMaster).values(values).onConflictDoUpdate({ target: resumeMaster.id, set: values }).run()
  const row = masterRow()
  if (!row) throw new Error('Failed to read back the saved master resume')
  return toMaster(row)
}

/** Removes the master and every variant (their jobs go back to the fallback): a variant without a master has nothing to diff against. */
export function deleteMasterResume(): void {
  const db = getDb()
  db.delete(resumeVariants).run()
  db.delete(resumeMaster).where(eq(resumeMaster.id, MASTER_ID)).run()
}

function isStale(row: VariantRow, masterUpdatedAt: string | null): boolean {
  return masterUpdatedAt !== null && row.basedOnMasterUpdatedAt < masterUpdatedAt
}

/**
 * Everything the lists, the job-card indicator and the job detail modal's
 * assignment picker need, without decrypting a single payload. One query
 * for the variants and one for the jobs pointing at them, joined in memory:
 * both are bounded by the user's own board, and a variant with no jobs must
 * still appear, which a plain inner join would drop. Ordered by name, since
 * that is how the user refers to them.
 */
export function listVariantSummaries(): ResumeVariantSummary[] {
  const db = getDb()
  const master = masterRow()
  const masterUpdatedAt = master?.updatedAt ?? null
  const links = new Map<string, ResumeVariantJobLink[]>()
  for (const job of db
    .select({ id: jobs.id, title: jobs.title, company: jobs.company, status: jobs.status, variantId: jobs.resumeVariantId })
    .from(jobs)
    .where(isNotNull(jobs.resumeVariantId))
    .orderBy(desc(jobs.createdAt))
    .all()) {
    if (!job.variantId) continue
    const list = links.get(job.variantId) ?? []
    list.push({ id: job.id, title: job.title, company: job.company, status: job.status })
    links.set(job.variantId, list)
  }
  return db
    .select()
    .from(resumeVariants)
    .orderBy(asc(sql`lower(${resumeVariants.name})`))
    .all()
    .map((row) => {
      const jobLinks = links.get(row.id) ?? []
      return {
        id: row.id,
        name: row.name,
        templateId: templateOf(row.templateId),
        updatedAt: row.updatedAt,
        stale: isStale(row, masterUpdatedAt),
        jobCount: jobLinks.length,
        jobs: jobLinks
      }
    })
}

function variantRow(id: string): VariantRow | undefined {
  return getDb().select().from(resumeVariants).where(eq(resumeVariants.id, id)).get()
}

/**
 * Case-insensitive, whitespace-normalised: the agent and the user type
 * names, they do not paste ids. The match runs in JavaScript over the
 * (short) name list rather than in SQL, since SQLite's `lower()` would treat
 * "Résumé" and "RÉSUMÉ" as different names; see `resumeVariantNameKey`.
 */
function variantRowByName(name: string): VariantRow | undefined {
  const normalized = normalizeResumeVariantName(name)
  if (!normalized) return undefined
  const key = resumeVariantNameKey(normalized)
  const match = getDb()
    .select({ id: resumeVariants.id, name: resumeVariants.name })
    .from(resumeVariants)
    .all()
    .find((row) => resumeVariantNameKey(row.name) === key)
  return match ? variantRow(match.id) : undefined
}

export function getVariant(id: string): ResumeVariant | null {
  const row = variantRow(id)
  return row ? toVariant(row) : null
}

export function getVariantByName(name: string): ResumeVariant | null {
  const row = variantRowByName(name)
  return row ? toVariant(row) : null
}

/** The variant assigned to a job, through `jobs.resume_variant_id`; null for an unknown job as well as an unassigned one. */
export function getVariantByJob(jobId: string): ResumeVariant | null {
  const row = getDb()
    .select({ variant: resumeVariants })
    .from(jobs)
    .innerJoin(resumeVariants, eq(resumeVariants.id, jobs.resumeVariantId))
    .where(eq(jobs.id, jobId))
    .get()
  return row ? toVariant(row.variant) : null
}

export function isVariantStale(variant: ResumeVariant): boolean {
  const master = masterRow()
  return master !== undefined && variant.basedOnMasterUpdatedAt < master.updatedAt
}

export type ResumeVariantErrorCode =
  | 'masterResumeMissing'
  | 'jobNotFound'
  | 'variantNotFound'
  | 'variantNameTaken'
  | 'invalidResumeData'

/** Typed so the IPC layer can map it to an error code and the MCP tools can quote the message. */
export class ResumeVariantError extends Error {
  constructor(
    readonly code: ResumeVariantErrorCode,
    message: string,
    readonly params?: Record<string, string>
  ) {
    super(message)
    this.name = 'ResumeVariantError'
  }
}

export interface SaveVariantInput {
  /** Update this variant (rename, new content, new template). Without it the name decides: an existing variant of that name is replaced, otherwise one is created. */
  id?: string
  name: string
  /**
   * Without an id, what a name that is already taken means. The agent's
   * `save_resume_variant` replaces (writing "Backend" again is the natural
   * way to revise it); the app's "New variant" form rejects, since a user
   * naming a new draft is not asking to overwrite a variant jobs are using.
   */
  onNameTaken?: 'replace' | 'reject'
  /** Required when creating; optional on an update, where leaving it out keeps the stored content *and* its stale stamp. */
  content?: ResumeContent
  templateId?: ResumeTemplateId
}

/**
 * Create, replace, rename or restyle a variant. Content is always written
 * against the current master, so saving content also clears the stale flag;
 * that is the "refresh" action, there is no separate one. A rename or a
 * template change alone leaves the stamp as it was, since the content did
 * not move any closer to the master. Names are unique case-insensitively:
 * "backend" and "Backend" are the same variant, whichever one the agent or
 * the user typed.
 */
export function saveVariant(input: SaveVariantInput): ResumeVariant {
  const db = getDb()
  const master = masterRow()
  if (!master) throw new ResumeVariantError('masterResumeMissing', 'No master resume exists to tailor from.')
  const name = normalizeResumeVariantName(input.name)
  if (!name) throw new ResumeVariantError('invalidResumeData', 'A variant needs a name.', { message: 'A variant needs a name.' })

  const sameName = variantRowByName(name)
  let existing: VariantRow | undefined
  if (input.id !== undefined) {
    existing = variantRow(input.id)
    if (!existing) throw new ResumeVariantError('variantNotFound', `No resume variant with id ${input.id}.`)
    if (sameName && sameName.id !== existing.id) {
      throw new ResumeVariantError('variantNameTaken', `A resume variant named "${sameName.name}" already exists.`, {
        name: sameName.name
      })
    }
  } else if (sameName && input.onNameTaken === 'reject') {
    throw new ResumeVariantError('variantNameTaken', `A resume variant named "${sameName.name}" already exists.`, {
      name: sameName.name
    })
  } else {
    existing = sameName
  }
  if (!existing && !input.content) {
    throw new ResumeVariantError('invalidResumeData', 'A new variant needs content.', { message: 'A new variant needs content.' })
  }

  const now = new Date().toISOString()
  const values = {
    id: existing?.id ?? randomUUID(),
    name,
    securePayload: input.content ? encodeContent(input.content, currentMode()) : existing!.securePayload,
    templateId: input.templateId ?? (existing ? templateOf(existing.templateId) : templateOf(master.templateId)),
    basedOnMasterUpdatedAt: input.content ? master.updatedAt : existing!.basedOnMasterUpdatedAt,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  }
  db.insert(resumeVariants).values(values).onConflictDoUpdate({ target: resumeVariants.id, set: values }).run()
  const row = variantRow(values.id)
  if (!row) throw new Error('Failed to read back the saved resume variant')
  return toVariant(row)
}

/**
 * Points a job at a variant, or back at the fallback with `null`. The job
 * row's `updatedAt` is bumped so the board's live update carries the
 * change. Returns the job as the board will now see it.
 */
export function assignVariant(jobId: string, variantId: string | null): JobRecord {
  const db = getDb()
  const job = db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, jobId)).get()
  if (!job) throw new ResumeVariantError('jobNotFound', `No tracked job with id ${jobId}.`)
  if (variantId !== null && !variantRow(variantId)) {
    throw new ResumeVariantError('variantNotFound', `No resume variant with id ${variantId}.`)
  }
  db.update(jobs).set({ resumeVariantId: variantId, updatedAt: new Date().toISOString() }).where(eq(jobs.id, jobId)).run()
  const updated = getJob(jobId)
  if (!updated) throw new Error('Failed to read back the job after assigning a resume variant')
  return updated
}

/** Jobs currently pointing at a variant, newest first; what the delete confirmation and the agent's result count. */
export function listJobsUsingVariant(variantId: string): JobRecord[] {
  return getDb()
    .select({ id: jobs.id })
    .from(jobs)
    .where(eq(jobs.resumeVariantId, variantId))
    .orderBy(desc(jobs.createdAt))
    .all()
    .map((row) => getJob(row.id))
    .filter((job): job is JobRecord => job !== null)
}

/**
 * Removes a variant; the jobs using it fall back to the master or the
 * original upload (the `ON DELETE SET NULL` on `jobs.resume_variant_id`).
 * A missing variant is not an error for callers that only want it gone.
 */
export function deleteVariant(id: string): { removed: boolean; unassignedJobs: number } {
  const db = getDb()
  const existing = db.select({ id: resumeVariants.id }).from(resumeVariants).where(eq(resumeVariants.id, id)).get()
  if (!existing) return { removed: false, unassignedJobs: 0 }
  const unassignedJobs = db.select({ id: jobs.id }).from(jobs).where(eq(jobs.resumeVariantId, id)).all().length
  db.delete(resumeVariants).where(eq(resumeVariants.id, id)).run()
  return { removed: true, unassignedJobs }
}

export function countVariants(): number {
  return getDb().select({ id: resumeVariants.id }).from(resumeVariants).all().length
}

/**
 * Re-encodes every payload for a storage-mode switch. Decodes with the
 * stored marker and re-encodes with the requested mode, like
 * `rewriteDocumentStorageMode`; `updatedAt` is deliberately left alone since
 * the content did not change and variants must not go stale over it.
 */
export function rewriteResumeStorageMode(mode: StorageMode): void {
  const db = getDb()
  const master = masterRow()
  if (master) {
    db.update(resumeMaster)
      .set({ securePayload: encodeContent(decodeContent(master.securePayload, 'master resume'), mode) })
      .where(eq(resumeMaster.id, MASTER_ID))
      .run()
  }
  for (const row of db.select().from(resumeVariants).all()) {
    db.update(resumeVariants)
      .set({ securePayload: encodeContent(decodeContent(row.securePayload, 'resume variant'), mode) })
      .where(eq(resumeVariants.id, row.id))
      .run()
  }
}

/** Full variants for export, by name; bounded by what the user has written. */
export function listAllVariants(): ResumeVariant[] {
  return getDb()
    .select()
    .from(resumeVariants)
    .orderBy(asc(sql`lower(${resumeVariants.name})`))
    .all()
    .map(toVariant)
}

export interface ResumeImportBundle {
  master: { content: ResumeContent; templateId: ResumeTemplateId; pageSize: ResumePageSize; style?: ResumeStyle } | null
  variants: Array<{ name: string; content: ResumeContent; templateId: ResumeTemplateId }>
}

/**
 * Import replaces the master (a backup restore means "make it look like the
 * backup") and upserts variants by name; without a master (none in the
 * bundle, none here) they are counted as skipped rather than failing the
 * whole import. Which job uses which variant travels with the jobs (see
 * `linkVariantsByName`), so this needs no job at all.
 */
export function importResumes(bundle: ResumeImportBundle): { imported: number; skipped: number } {
  let imported = 0
  let skipped = 0
  if (bundle.master) {
    saveMasterResume({
      content: bundle.master.content,
      templateId: bundle.master.templateId,
      pageSize: bundle.master.pageSize,
      style: bundle.master.style ?? {},
      sourceDocumentId: null
    })
    imported++
  }
  if (!hasMasterResume()) {
    return { imported, skipped: bundle.variants.length }
  }
  for (const variant of bundle.variants) {
    try {
      saveVariant({ name: variant.name, content: variant.content, templateId: variant.templateId })
      imported++
    } catch (err) {
      if (err instanceof ResumeVariantError) {
        skipped++
        continue
      }
      throw err
    }
  }
  return { imported, skipped }
}

/**
 * Re-creates job → variant assignments from an export, where a job is
 * identified by its URL (ids are minted on import) and a variant by its
 * name. Only jobs with no assignment yet are touched: a job that already
 * existed here with its own variant keeps it, the same way the jobs import
 * keeps an existing row. A name that matches nothing (the resumes domain was
 * not imported, or the variant was deleted before the export) is counted,
 * not an error.
 */
export function linkVariantsByName(links: Array<{ jobUrl: string; variantName: string }>): {
  linked: number
  unresolved: number
} {
  const db = getDb()
  let linked = 0
  let unresolved = 0
  for (const link of links) {
    const variant = variantRowByName(link.variantName)
    const job = db
      .select({ id: jobs.id, variantId: jobs.resumeVariantId })
      .from(jobs)
      .where(eq(jobs.url, link.jobUrl))
      .get()
    if (!variant || !job) {
      unresolved++
      continue
    }
    if (job.variantId !== null) continue
    db.update(jobs).set({ resumeVariantId: variant.id }).where(eq(jobs.id, job.id)).run()
    linked++
  }
  return { linked, unresolved }
}

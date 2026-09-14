/*
 * Structured resume content, shared by the main process (storage, PDF
 * rendering, MCP tools), the renderer (editor, preview, diff) and the import
 * schema.
 *
 * Sections are typed by *shape*, not by *meaning*. There is no built-in
 * "experience" or "education": a section is a free-text title plus one of
 * four layouts a template knows how to draw, so "Volunteering",
 * "Publications", "Selected Talks" or a heading in another language all work
 * without touching the schema. The four layouts are what every common resume
 * section reduces to once you ignore its name:
 *
 * - `text`: one paragraph (summary, objective, profile).
 * - `entries`: dated items with a title line and bullets (jobs, degrees,
 *   projects, volunteering, publications).
 * - `groups`: labelled lists (skills by category, languages with levels).
 * - `list`: a flat list (certifications, awards, interests).
 *
 * Every section, entry, group and contact carries a stable `id`. Variants are
 * full copies of the master's content, and those ids are how the diff matches
 * a tailored entry back to the original, and how `save_resume_variant` tells
 * a reworded job from an invented one.
 */

import type { JobStatus } from './job'

export type ResumeTemplateId = 'classic' | 'compact' | 'modern'
export const RESUME_TEMPLATE_IDS: readonly ResumeTemplateId[] = ['classic', 'compact', 'modern']

export type ResumePageSize = 'letter' | 'a4'
export const RESUME_PAGE_SIZES: readonly ResumePageSize[] = ['letter', 'a4']

export type ResumeSectionLayoutKind = 'text' | 'entries' | 'groups' | 'list'
export const RESUME_SECTION_LAYOUT_KINDS: readonly ResumeSectionLayoutKind[] = ['text', 'entries', 'groups', 'list']

export interface ResumeContact {
  id: string
  /** Shown by some templates ("Email", "Phone"); others print only the value. */
  label: string
  value: string
  /** Optional link target; templates only emit it when it is http(s) or mailto. */
  url?: string
}

export interface ResumeHeader {
  fullName: string
  headline?: string
  contacts: ResumeContact[]
}

export interface ResumeEntry {
  id: string
  /** Role, degree, project name. */
  title: string
  /** Organization, institution. */
  subtitle?: string
  /** Location, or anything else shown opposite the subtitle. */
  meta?: string
  /** Free text ("2021", "Mar 2023", "Present"); templates print "start - end". */
  start?: string
  end?: string
  url?: string
  bullets: string[]
}

export interface ResumeGroup {
  id: string
  label: string
  items: string[]
}

export type ResumeSectionLayout =
  | { kind: 'text'; body: string }
  | { kind: 'entries'; entries: ResumeEntry[] }
  | { kind: 'groups'; groups: ResumeGroup[] }
  | { kind: 'list'; items: string[] }

export interface ResumeSection {
  id: string
  title: string
  layout: ResumeSectionLayout
}

export interface ResumeContent {
  header: ResumeHeader
  sections: ResumeSection[]
}

/**
 * Typography the user can set on top of a template. Both fields are optional
 * and an absent one means "whatever the template does", so a resume saved
 * before this existed renders exactly as it did. Families are named stacks
 * of system fonts (the PDF is rendered on this machine, and nothing is
 * downloaded), and the size is the body size in points; every other size
 * in a template is relative to it.
 */
export type ResumeFontFamily = 'georgia' | 'times' | 'garamond' | 'helvetica' | 'calibri' | 'segoe'
export const RESUME_FONT_FAMILIES: readonly ResumeFontFamily[] = ['georgia', 'times', 'garamond', 'helvetica', 'calibri', 'segoe']
export const RESUME_FONT_STACKS: Record<ResumeFontFamily, string> = {
  georgia: "Georgia, 'Times New Roman', serif",
  times: "'Times New Roman', Times, 'Liberation Serif', serif",
  garamond: "Garamond, 'EB Garamond', 'Cormorant Garamond', Georgia, serif",
  helvetica: "Helvetica, Arial, 'Liberation Sans', sans-serif",
  calibri: "Calibri, Carlito, 'Segoe UI', Arial, sans-serif",
  segoe: "'Segoe UI', -apple-system, Roboto, Helvetica, Arial, sans-serif"
}
export const RESUME_FONT_SIZE_MIN_PT = 8
export const RESUME_FONT_SIZE_MAX_PT = 14
/** Half-point steps between the bounds, for the size picker. */
export const RESUME_FONT_SIZES_PT: readonly number[] = Array.from(
  { length: (RESUME_FONT_SIZE_MAX_PT - RESUME_FONT_SIZE_MIN_PT) * 2 + 1 },
  (_, index) => RESUME_FONT_SIZE_MIN_PT + index / 2
)

/** How hyperlinks (contacts, entry titles with a url) look: like the surrounding text, blue, or underlined. */
export type ResumeLinkStyle = 'plain' | 'blue' | 'underline'
export const RESUME_LINK_STYLES: readonly ResumeLinkStyle[] = ['plain', 'blue', 'underline']

export function isResumeLinkStyle(value: unknown): value is ResumeLinkStyle {
  return typeof value === 'string' && (RESUME_LINK_STYLES as readonly string[]).includes(value)
}

export interface ResumeStyle {
  fontFamily?: ResumeFontFamily
  /** Body size in points, RESUME_FONT_SIZE_MIN_PT..MAX in half-point steps. */
  fontSize?: number
  /** Absent means plain (links read as text, and still click through in the PDF). */
  linkStyle?: ResumeLinkStyle
}

export const DEFAULT_RESUME_STYLE: ResumeStyle = {}

export function isResumeFontFamily(value: unknown): value is ResumeFontFamily {
  return typeof value === 'string' && (RESUME_FONT_FAMILIES as readonly string[]).includes(value)
}

/** Clamps to the allowed range on a half-point grid; anything unusable comes back undefined. */
export function normalizeResumeFontSize(value: unknown): number | undefined {
  const size = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(size)) return undefined
  const snapped = Math.round(size * 2) / 2
  return Math.min(RESUME_FONT_SIZE_MAX_PT, Math.max(RESUME_FONT_SIZE_MIN_PT, snapped))
}

/** Rebuilds a style from untrusted input (a stored JSON column, an IPC payload); unknown keys and bad values are dropped. */
export function normalizeResumeStyle(value: unknown): ResumeStyle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  const style: ResumeStyle = {}
  if (isResumeFontFamily(record.fontFamily)) style.fontFamily = record.fontFamily
  const fontSize = normalizeResumeFontSize(record.fontSize)
  if (fontSize !== undefined) style.fontSize = fontSize
  if (isResumeLinkStyle(record.linkStyle)) style.linkStyle = record.linkStyle
  return style
}

export interface MasterResume {
  content: ResumeContent
  templateId: ResumeTemplateId
  pageSize: ResumePageSize
  /** Typography over the template; variants inherit it (they only pick a template). */
  style: ResumeStyle
  /** The upload the agent imported this from, if any; the upload may since have been deleted. */
  sourceDocumentId: string | null
  createdAt: string
  updatedAt: string
}

/** Longest allowed variant name; long enough for "Senior Backend Engineer at Northwind Traders (2)", short enough for a list row. */
export const RESUME_VARIANT_NAME_MAX_CHARS = 80

/**
 * A named, reusable tailored copy of the master. Jobs point at a variant
 * (`JobRecord.resumeVariantId`), many jobs to one variant, so the variant
 * itself knows nothing about jobs; `ResumeVariantSummary` joins them in for
 * the lists.
 */
export interface ResumeVariant {
  id: string
  /** Short, unique (case-insensitively), user-facing: "Backend-focused", "Concise one-page". */
  name: string
  content: ResumeContent
  templateId: ResumeTemplateId
  /** The master's `updatedAt` when this variant's content was written; older than the current one means stale. */
  basedOnMasterUpdatedAt: string
  createdAt: string
  updatedAt: string
}

/** A job that uses a variant, as the variant list shows it. */
export interface ResumeVariantJobLink {
  id: string
  title: string
  company: string
  status: JobStatus
}

/** What lists and the job-card indicator need, without the content payload. The jobs using the variant are joined in so the list needs no second fetch. */
export interface ResumeVariantSummary {
  id: string
  name: string
  templateId: ResumeTemplateId
  updatedAt: string
  stale: boolean
  jobCount: number
  jobs: ResumeVariantJobLink[]
}

/** Trims and bounds a name from any source (the editor, the agent, an import); null when nothing usable is left. */
export function normalizeResumeVariantName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.replace(/\s+/g, ' ').trim()
  if (!trimmed) return null
  return trimmed.slice(0, RESUME_VARIANT_NAME_MAX_CHARS)
}

/**
 * The key two names are compared by: "Backend" and "backend" are the same
 * variant, and so are "Résumé" and "RÉSUMÉ". SQLite's `lower()` folds only
 * ASCII, so the comparison is done in JavaScript, on the NFC form so a
 * precomposed and a decomposed accent do not count as two names either.
 */
export function resumeVariantNameKey(name: string): string {
  return name.normalize('NFC').toLowerCase()
}

/** What gets attached to an application when the job has no variant of its own. */
export type ResumeFallbackAttachment = 'original' | 'master'

export interface ResumeSettings {
  fallbackAttachment: ResumeFallbackAttachment
  /** When on, the agent instructions tell it to tailor right after queueing a job. */
  autoTailor: boolean
}

export const DEFAULT_RESUME_SETTINGS: ResumeSettings = { fallbackAttachment: 'original', autoTailor: false }

export const EMPTY_RESUME_CONTENT: ResumeContent = { header: { fullName: '', contacts: [] }, sections: [] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function isContact(value: unknown): value is ResumeContact {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    typeof value.value === 'string' &&
    isOptionalString(value.url)
  )
}

function isEntry(value: unknown): value is ResumeEntry {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    isOptionalString(value.subtitle) &&
    isOptionalString(value.meta) &&
    isOptionalString(value.start) &&
    isOptionalString(value.end) &&
    isOptionalString(value.url) &&
    isStringArray(value.bullets)
  )
}

function isGroup(value: unknown): value is ResumeGroup {
  return isRecord(value) && typeof value.id === 'string' && typeof value.label === 'string' && isStringArray(value.items)
}

function isLayout(value: unknown): value is ResumeSectionLayout {
  if (!isRecord(value)) return false
  switch (value.kind) {
    case 'text':
      return typeof value.body === 'string'
    case 'entries':
      return Array.isArray(value.entries) && value.entries.every(isEntry)
    case 'groups':
      return Array.isArray(value.groups) && value.groups.every(isGroup)
    case 'list':
      return isStringArray(value.items)
    default:
      return false
  }
}

function isSection(value: unknown): value is ResumeSection {
  return isRecord(value) && typeof value.id === 'string' && typeof value.title === 'string' && isLayout(value.layout)
}

/** Structural check only; size limits are the zod schema's job (`shared/resume/resumeContentSchema.ts`). */
export function isResumeContent(value: unknown): value is ResumeContent {
  if (!isRecord(value) || !isRecord(value.header)) return false
  const header = value.header
  if (typeof header.fullName !== 'string' || !isOptionalString(header.headline)) return false
  if (!Array.isArray(header.contacts) || !header.contacts.every(isContact)) return false
  return Array.isArray(value.sections) && value.sections.every(isSection)
}

/**
 * Brings a stored payload up to the current shape. Today that is only
 * back-filling arrays a future field might leave out; it exists so a payload
 * written by an older build keeps loading after the type grows, the same job
 * `normalizeProfileFields` does for the profile envelope. Returns null when
 * the value is not a resume at all, so callers can report corruption instead
 * of rendering garbage.
 */
export function normalizeResumeContent(value: unknown): ResumeContent | null {
  if (!isRecord(value) || !isRecord(value.header)) return null
  const candidate = {
    header: { ...value.header, contacts: value.header.contacts ?? [] },
    sections: value.sections ?? []
  }
  return isResumeContent(candidate) ? candidate : null
}

export function isResumeTemplateId(value: unknown): value is ResumeTemplateId {
  return typeof value === 'string' && (RESUME_TEMPLATE_IDS as readonly string[]).includes(value)
}

export function isResumePageSize(value: unknown): value is ResumePageSize {
  return typeof value === 'string' && (RESUME_PAGE_SIZES as readonly string[]).includes(value)
}

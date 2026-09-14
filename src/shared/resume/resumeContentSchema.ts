import { z } from 'zod'
import {
  RESUME_MAX_BULLETS_PER_ENTRY,
  RESUME_MAX_ITEMS_PER_SECTION,
  RESUME_MAX_SECTIONS,
  RESUME_MAX_TEXT_CHARS
} from '../constants'
import {
  RESUME_FONT_FAMILIES,
  RESUME_LINK_STYLES,
  RESUME_FONT_SIZE_MAX_PT,
  RESUME_FONT_SIZE_MIN_PT,
  RESUME_PAGE_SIZES,
  RESUME_TEMPLATE_IDS,
  RESUME_VARIANT_NAME_MAX_CHARS,
  type ResumeContent,
  type ResumeFontFamily,
  type ResumeLinkStyle,
  type ResumePageSize,
  type ResumeTemplateId
} from '../types/resume'

/*
 * The one validator for resume content, used by the MCP tool shapes, the IPC
 * payload schemas and the export/import schema, so the agent, the editor and
 * a restored backup are all held to the same limits. `isResumeContent` in
 * `types/resume.ts` is the cheap structural check for values already in the
 * database; this is the strict one for values arriving from outside.
 *
 * Ids are short, stable tokens rather than free text: they are matched, never
 * displayed, and a variant's ids must be a subset of the master's for
 * `tailor_resume` to prove nothing was invented.
 */

const id = z.string().trim().min(1).max(64)
const shortText = z.string().trim().max(200)
const text = z.string().trim().max(RESUME_MAX_TEXT_CHARS)
const optionalShortText = shortText.optional()
const textList = (max: number): z.ZodArray<typeof text> => z.array(text).max(max)

export const resumeContactSchema = z.object({
  id,
  label: shortText,
  value: shortText.min(1),
  url: optionalShortText
})

export const resumeEntrySchema = z.object({
  id,
  title: shortText.min(1),
  subtitle: optionalShortText,
  meta: optionalShortText,
  start: optionalShortText,
  end: optionalShortText,
  url: optionalShortText,
  bullets: textList(RESUME_MAX_BULLETS_PER_ENTRY)
})

export const resumeGroupSchema = z.object({
  id,
  label: shortText.min(1),
  items: textList(RESUME_MAX_BULLETS_PER_ENTRY)
})

export const resumeSectionLayoutSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), body: text }),
  z.object({ kind: z.literal('entries'), entries: z.array(resumeEntrySchema).max(RESUME_MAX_ITEMS_PER_SECTION) }),
  z.object({ kind: z.literal('groups'), groups: z.array(resumeGroupSchema).max(RESUME_MAX_ITEMS_PER_SECTION) }),
  z.object({ kind: z.literal('list'), items: textList(RESUME_MAX_ITEMS_PER_SECTION) })
])

export const resumeSectionSchema = z.object({
  id,
  title: shortText.min(1),
  layout: resumeSectionLayoutSchema
})

export const resumeContentSchema = z.object({
  header: z.object({
    fullName: shortText.min(1),
    headline: optionalShortText,
    contacts: z.array(resumeContactSchema).max(RESUME_MAX_ITEMS_PER_SECTION)
  }),
  sections: z.array(resumeSectionSchema).max(RESUME_MAX_SECTIONS)
})

/** Whitespace-collapsed and bounded like the repository does it, so a name the schema accepts is the name that gets stored. */
export const resumeVariantNameSchema = z
  .string()
  .transform((value) => value.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1, 'A variant needs a name.').max(RESUME_VARIANT_NAME_MAX_CHARS))

export const resumeTemplateIdSchema = z.enum(RESUME_TEMPLATE_IDS as readonly [ResumeTemplateId, ...ResumeTemplateId[]])
export const resumeStyleSchema = z.object({
  fontFamily: z.enum(RESUME_FONT_FAMILIES as readonly [ResumeFontFamily, ...ResumeFontFamily[]]).optional(),
  fontSize: z
    .number()
    .min(RESUME_FONT_SIZE_MIN_PT)
    .max(RESUME_FONT_SIZE_MAX_PT)
    .refine((size) => Number.isInteger(size * 2), { message: 'Font size must be a whole or half point' })
    .optional(),
  linkStyle: z.enum(RESUME_LINK_STYLES as readonly [ResumeLinkStyle, ...ResumeLinkStyle[]]).optional()
})

export const resumePageSizeSchema = z.enum(RESUME_PAGE_SIZES as readonly [ResumePageSize, ...ResumePageSize[]])

/**
 * Ids must be unique within their own kind across the whole document
 * (contacts, sections, entries, groups), or the diff and the editor's keyed
 * updates would silently act on the wrong item. Entries and groups are
 * checked across sections, not per section: the same entry id in two
 * sections would keep a "known" id while being a different item, which is
 * exactly what the fabrication guard relies on ids to tell apart. Kept out
 * of the zod shape so the MCP input schema stays a plain object the SDK can
 * serialize.
 */
export function duplicateResumeIds(content: ResumeContent): string[] {
  const duplicates = new Set<string>()
  const check = (ids: string[]): void => {
    const seen = new Set<string>()
    for (const value of ids) {
      if (seen.has(value)) duplicates.add(value)
      seen.add(value)
    }
  }
  check(content.header.contacts.map((contact) => contact.id))
  check(content.sections.map((section) => section.id))
  check(content.sections.flatMap((section) => (section.layout.kind === 'entries' ? section.layout.entries.map((entry) => entry.id) : [])))
  check(content.sections.flatMap((section) => (section.layout.kind === 'groups' ? section.layout.groups.map((group) => group.id) : [])))
  return [...duplicates]
}

export type ResumeContentValidation = { ok: true; content: ResumeContent } | { ok: false; message: string }

/** Full validation (shape, limits, unique ids) with a single human-readable failure message. */
export function validateResumeContent(value: unknown): ResumeContentValidation {
  const parsed = resumeContentSchema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path = issue?.path.length ? ` at ${issue.path.join('.')}` : ''
    return { ok: false, message: `${issue?.message ?? 'Invalid resume content'}${path}` }
  }
  const duplicates = duplicateResumeIds(parsed.data)
  if (duplicates.length > 0) {
    return { ok: false, message: `Duplicate ids: ${duplicates.join(', ')}` }
  }
  return { ok: true, content: parsed.data }
}

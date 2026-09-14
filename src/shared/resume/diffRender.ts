import type {
  ResumeContact,
  ResumeContent,
  ResumeEntry,
  ResumeGroup,
  ResumePageSize,
  ResumeSection,
  ResumeStyle,
  ResumeTemplateId
} from '../types/resume'
import { diffResumeContent, diffStringLists, type FieldChange, type ResumeDiff, type SectionDiff, type StringChange } from './resumeDiff'
import { escapeHtml } from './escapeHtml'
import { renderResumeHtml } from './templates'

/*
 * The diff drawn on the resume itself: the variant rendered through its
 * template with additions highlighted green and removals struck through in
 * red, in place, so "what changed" is read on the page a recruiter would
 * see rather than in a separate list.
 *
 * Templates escape every string, so markup cannot be smuggled through the
 * content. Instead the annotated content carries private control-character
 * markers around changed text (stripped from the input first so user text
 * can never open or close one), the ordinary renderer runs, and the markers
 * are swapped for `<ins>`/`<del>` in the finished HTML. `<title>` is the
 * one place a mark makes no sense, so it is set to the variant's name.
 */

const ADD_OPEN = '\u0001'
const ADD_CLOSE = '\u0002'
const DEL_OPEN = '\u0003'
const DEL_CLOSE = '\u0004'
// eslint-disable-next-line no-control-regex
const MARKERS = /[\u0001-\u0004]/g

const DIFF_CSS = `
ins.diff-add { background: #d6f3dc; color: #0d5c25; text-decoration: none; padding: 0 1px; }
del.diff-del { background: #fbdede; color: #9b1c1c; text-decoration: line-through; padding: 0 1px; }
`

function add(text: string): string {
  return text ? `${ADD_OPEN}${text}${ADD_CLOSE}` : ''
}

function del(text: string): string {
  return text ? `${DEL_OPEN}${text}${DEL_CLOSE}` : ''
}

function both(from: string, to: string): string {
  return [del(from), add(to)].filter(Boolean).join(' ')
}

/** A changed field shows the old value struck and the new one highlighted; an unchanged one prints as is. */
function fieldText(changes: FieldChange[], field: string, current: string | undefined): string | undefined {
  const change = changes.find((candidate) => candidate.field === field)
  if (!change) return current
  return both(change.from, change.to) || undefined
}

/**
 * A link's destination is invisible on the page, so a changed `url` behind
 * unchanged text (the word LinkedIn now pointing somewhere else) would show
 * nothing at all. The old and new addresses are printed after the text
 * instead; the link itself still points at the variant's address.
 */
function withUrlChange(text: string, changes: FieldChange[]): string {
  const change = changes.find((candidate) => candidate.field === 'url')
  if (!change) return text
  const shown = both(change.from, change.to)
  return shown ? `${text} ${shown}` : text
}

function stringChanges(changes: StringChange[]): string[] {
  return changes.map((change) => (change.kind === 'kept' ? change.text : change.kind === 'added' ? add(change.text) : del(change.text)))
}

/** Prose is diffed word by word so a reworded sentence keeps its unchanged words readable. */
function proseDiff(from: string, to: string): string {
  if (!from) return add(to)
  if (!to) return del(from)
  return stringChanges(diffStringLists(from.split(/\s+/), to.split(/\s+/))).join(' ')
}

function markEntry(entry: ResumeEntry, mark: (text: string) => string): ResumeEntry {
  return {
    ...entry,
    title: mark(entry.title),
    subtitle: entry.subtitle ? mark(entry.subtitle) : entry.subtitle,
    meta: entry.meta ? mark(entry.meta) : entry.meta,
    start: entry.start ? mark(entry.start) : entry.start,
    end: entry.end ? mark(entry.end) : entry.end,
    bullets: entry.bullets.map(mark)
  }
}

function markGroup(group: ResumeGroup, mark: (text: string) => string): ResumeGroup {
  return { ...group, label: mark(group.label), items: group.items.map(mark) }
}

function markContact(contact: ResumeContact, mark: (text: string) => string): ResumeContact {
  return { ...contact, label: mark(contact.label), value: mark(contact.value) }
}

function annotateEntries(diff: SectionDiff): ResumeEntry[] {
  return diff.entries.map((entryDiff) => {
    const { entry } = entryDiff
    if (entryDiff.status === 'added') return markEntry(entry, add)
    if (entryDiff.status === 'removed') return markEntry(entry, del)
    const changes = entryDiff.fieldChanges
    return {
      ...entry,
      title: withUrlChange(fieldText(changes, 'title', entry.title) ?? entry.title, changes),
      subtitle: fieldText(changes, 'subtitle', entry.subtitle),
      meta: fieldText(changes, 'meta', entry.meta),
      start: fieldText(changes, 'start', entry.start),
      end: fieldText(changes, 'end', entry.end),
      bullets: stringChanges(entryDiff.bullets)
    }
  })
}

function annotateGroups(diff: SectionDiff): ResumeGroup[] {
  return diff.groups.map((groupDiff) => {
    const { group } = groupDiff
    if (groupDiff.status === 'added') return markGroup(group, add)
    if (groupDiff.status === 'removed') return markGroup(group, del)
    return {
      ...group,
      label: groupDiff.labelChange ? both(groupDiff.labelChange.from, groupDiff.labelChange.to) : group.label,
      items: stringChanges(groupDiff.items)
    }
  })
}

/**
 * A section whose layout kind changed is two sections on the page: the
 * master's, struck through, then the variant's, highlighted. Everything
 * else is one section with its leaves marked.
 */
function annotateSection(diff: SectionDiff, master: ResumeContent): ResumeSection[] {
  const { section } = diff
  if (diff.layoutChange) {
    const before = master.sections.find((candidate) => candidate.id === section.id)
    const removed = before ? annotateWhole(before, del, `${section.id}:removed`) : []
    return [...removed, ...annotateWhole(section, add, section.id)]
  }
  if (diff.status === 'added') return annotateWhole(section, add, section.id)
  if (diff.status === 'removed') return annotateWhole(section, del, section.id)

  const title = diff.titleChange ? both(diff.titleChange.from, diff.titleChange.to) : section.title
  switch (section.layout.kind) {
    case 'text':
      return [{ ...section, title, layout: { kind: 'text', body: diff.text ? proseDiff(diff.text.from, diff.text.to) : section.layout.body } }]
    case 'entries':
      return [{ ...section, title, layout: { kind: 'entries', entries: annotateEntries(diff) } }]
    case 'groups':
      return [{ ...section, title, layout: { kind: 'groups', groups: annotateGroups(diff) } }]
    case 'list':
      return [{ ...section, title, layout: { kind: 'list', items: stringChanges(diff.items) } }]
  }
}

function annotateWhole(section: ResumeSection, mark: (text: string) => string, id: string): ResumeSection[] {
  const layout = section.layout
  const title = mark(section.title)
  switch (layout.kind) {
    case 'text':
      return [{ id, title, layout: { kind: 'text', body: mark(layout.body) } }]
    case 'entries':
      return [{ id, title, layout: { kind: 'entries', entries: layout.entries.map((entry) => markEntry(entry, mark)) } }]
    case 'groups':
      return [{ id, title, layout: { kind: 'groups', groups: layout.groups.map((group) => markGroup(group, mark)) } }]
    case 'list':
      return [{ id, title, layout: { kind: 'list', items: layout.items.map(mark) } }]
  }
}

function annotateHeader(diff: ResumeDiff, variant: ResumeContent): ResumeContent['header'] {
  const changes = diff.header.fieldChanges
  return {
    fullName: fieldText(changes, 'fullName', variant.header.fullName) ?? variant.header.fullName,
    headline: fieldText(changes, 'headline', variant.header.headline),
    contacts: diff.header.contacts.map((contactDiff) => {
      const { contact } = contactDiff
      if (contactDiff.status === 'added') return markContact(contact, add)
      if (contactDiff.status === 'removed') return markContact(contact, del)
      return {
        ...contact,
        label: fieldText(contactDiff.fieldChanges, 'label', contact.label) ?? contact.label,
        value: withUrlChange(fieldText(contactDiff.fieldChanges, 'value', contact.value) ?? contact.value, contactDiff.fieldChanges)
      }
    })
  }
}

/** User text never carries the marker characters in; a stray one would open or close a highlight. */
function stripMarkers<T>(value: T): T {
  if (typeof value === 'string') return value.replace(MARKERS, '') as T
  if (Array.isArray(value)) return value.map(stripMarkers) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, stripMarkers(item)])) as T
  }
  return value
}

/** The variant with every change marked, as ordinary content the templates can render. Exported for tests. */
export function annotateResumeDiff(master: ResumeContent, variant: ResumeContent): ResumeContent {
  const cleanMaster = stripMarkers(master)
  const cleanVariant = stripMarkers(variant)
  const diff = diffResumeContent(cleanMaster, cleanVariant)
  return {
    header: annotateHeader(diff, cleanVariant),
    sections: diff.sections.flatMap((section) => annotateSection(section, cleanMaster))
  }
}

export function renderResumeDiffHtml(
  master: ResumeContent,
  variant: ResumeContent,
  templateId: ResumeTemplateId,
  pageSize: ResumePageSize,
  style?: ResumeStyle
): string {
  const html = renderResumeHtml(annotateResumeDiff(master, variant), templateId, pageSize, style)
  const title = escapeHtml(stripMarkers(variant.header.fullName))
  return html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`)
    .replace(/<\/style>/, `${DIFF_CSS}</style>`)
    .replaceAll(ADD_OPEN, '<ins class="diff-add">')
    .replaceAll(ADD_CLOSE, '</ins>')
    .replaceAll(DEL_OPEN, '<del class="diff-del">')
    .replaceAll(DEL_CLOSE, '</del>')
}

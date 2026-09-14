import type {
  ResumeContact,
  ResumeContent,
  ResumeEntry,
  ResumeGroup,
  ResumeSection,
  ResumeSectionLayoutKind
} from '../types/resume'

/*
 * Structural diff between the master resume and a variant. Computed at view
 * time (never stored), so it always reflects the *current* master: when the
 * user edits the master after a variant was written, the diff is how they see
 * what the variant no longer says.
 *
 * Matching is by id at every level that has one (section, entry, group,
 * contact); leaf string lists (bullets, items) have no ids and are matched by
 * a longest-common-subsequence on the trimmed text, so a reworded bullet shows
 * up as one removal plus one addition, which is also what a reviewer wants to
 * read. The agent is told to keep ids when tailoring; an entry that arrives
 * with an unknown id is reported as added, and `unknownResumeIds` is the
 * check `tailor_resume` uses to refuse such a variant outright.
 */

export type ChangeStatus = 'added' | 'removed' | 'changed' | 'unchanged'

export interface StringChange {
  kind: 'kept' | 'added' | 'removed'
  text: string
}

export interface FieldChange {
  field: string
  from: string
  to: string
}

export interface EntryDiff {
  id: string
  status: ChangeStatus
  /** The variant's entry when present, else the master's (for removed). */
  entry: ResumeEntry
  fieldChanges: FieldChange[]
  bullets: StringChange[]
}

export interface GroupDiff {
  id: string
  status: ChangeStatus
  group: ResumeGroup
  labelChange: FieldChange | null
  items: StringChange[]
}

export interface ContactDiff {
  id: string
  status: ChangeStatus
  contact: ResumeContact
  fieldChanges: FieldChange[]
}

export interface SectionDiff {
  id: string
  status: ChangeStatus
  /** The variant's section when present, else the master's. */
  section: ResumeSection
  titleChange: FieldChange | null
  /** Set when the section exists on both sides but not in the same relative order. */
  moved: boolean
  /** Set when both sides have the section but with a different layout kind; the body is then shown as whole-section removed + added. */
  layoutChange: { from: ResumeSectionLayoutKind; to: ResumeSectionLayoutKind } | null
  text: { from: string; to: string } | null
  entries: EntryDiff[]
  groups: GroupDiff[]
  items: StringChange[]
}

export interface DiffSummary {
  added: number
  removed: number
  changed: number
}

export interface ResumeDiff {
  header: {
    fieldChanges: FieldChange[]
    contacts: ContactDiff[]
  }
  sections: SectionDiff[]
  summary: DiffSummary
}

function norm(value: string | undefined): string {
  return (value ?? '').trim()
}

/** LCS-based alignment of two short string lists. Both sides are bounded by the content limits, so the quadratic table is tiny. */
export function diffStringLists(before: string[], after: string[]): StringChange[] {
  const a = before.map(norm).filter((item) => item.length > 0)
  const b = after.map(norm).filter((item) => item.length > 0)
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    }
  }
  const changes: StringChange[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      changes.push({ kind: 'kept', text: a[i]! })
      i++
      j++
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      changes.push({ kind: 'removed', text: a[i]! })
      i++
    } else {
      changes.push({ kind: 'added', text: b[j]! })
      j++
    }
  }
  while (i < a.length) changes.push({ kind: 'removed', text: a[i++]! })
  while (j < b.length) changes.push({ kind: 'added', text: b[j++]! })
  return changes
}

function fieldChanges<T extends object>(before: T, after: T, fields: (keyof T & string)[]): FieldChange[] {
  const changes: FieldChange[] = []
  for (const field of fields) {
    const from = norm(before[field] as string | undefined)
    const to = norm(after[field] as string | undefined)
    if (from !== to) changes.push({ field, from, to })
  }
  return changes
}

function statusOf(hasChanges: boolean): ChangeStatus {
  return hasChanges ? 'changed' : 'unchanged'
}

function allAdded(items: string[]): StringChange[] {
  return items.map(norm).filter((text) => text.length > 0).map((text) => ({ kind: 'added' as const, text }))
}

function allRemoved(items: string[]): StringChange[] {
  return items.map(norm).filter((text) => text.length > 0).map((text) => ({ kind: 'removed' as const, text }))
}

const ENTRY_FIELDS: (keyof ResumeEntry & string)[] = ['title', 'subtitle', 'meta', 'start', 'end', 'url']

function diffEntries(before: ResumeEntry[], after: ResumeEntry[]): EntryDiff[] {
  const beforeById = new Map(before.map((entry) => [entry.id, entry]))
  const afterIds = new Set(after.map((entry) => entry.id))
  const result: EntryDiff[] = []
  for (const entry of after) {
    const original = beforeById.get(entry.id)
    if (!original) {
      result.push({ id: entry.id, status: 'added', entry, fieldChanges: [], bullets: allAdded(entry.bullets) })
      continue
    }
    const fields = fieldChanges(original, entry, ENTRY_FIELDS)
    const bullets = diffStringLists(original.bullets, entry.bullets)
    const changed = fields.length > 0 || bullets.some((change) => change.kind !== 'kept')
    result.push({ id: entry.id, status: statusOf(changed), entry, fieldChanges: fields, bullets })
  }
  for (const entry of before) {
    if (afterIds.has(entry.id)) continue
    result.push({ id: entry.id, status: 'removed', entry, fieldChanges: [], bullets: allRemoved(entry.bullets) })
  }
  return result
}

function diffGroups(before: ResumeGroup[], after: ResumeGroup[]): GroupDiff[] {
  const beforeById = new Map(before.map((group) => [group.id, group]))
  const afterIds = new Set(after.map((group) => group.id))
  const result: GroupDiff[] = []
  for (const group of after) {
    const original = beforeById.get(group.id)
    if (!original) {
      result.push({ id: group.id, status: 'added', group, labelChange: null, items: allAdded(group.items) })
      continue
    }
    const labelChange = fieldChanges(original, group, ['label'])[0] ?? null
    const items = diffStringLists(original.items, group.items)
    const changed = labelChange !== null || items.some((change) => change.kind !== 'kept')
    result.push({ id: group.id, status: statusOf(changed), group, labelChange, items })
  }
  for (const group of before) {
    if (afterIds.has(group.id)) continue
    result.push({ id: group.id, status: 'removed', group, labelChange: null, items: allRemoved(group.items) })
  }
  return result
}

function diffContacts(before: ResumeContact[], after: ResumeContact[]): ContactDiff[] {
  const beforeById = new Map(before.map((contact) => [contact.id, contact]))
  const afterIds = new Set(after.map((contact) => contact.id))
  const result: ContactDiff[] = []
  for (const contact of after) {
    const original = beforeById.get(contact.id)
    if (!original) {
      result.push({ id: contact.id, status: 'added', contact, fieldChanges: [] })
      continue
    }
    const changes = fieldChanges(original, contact, ['label', 'value', 'url'])
    result.push({ id: contact.id, status: statusOf(changes.length > 0), contact, fieldChanges: changes })
  }
  for (const contact of before) {
    if (!afterIds.has(contact.id)) result.push({ id: contact.id, status: 'removed', contact, fieldChanges: [] })
  }
  return result
}

function emptySectionDiff(section: ResumeSection, status: ChangeStatus): SectionDiff {
  return {
    id: section.id,
    status,
    section,
    titleChange: null,
    moved: false,
    layoutChange: null,
    text: null,
    entries: [],
    groups: [],
    items: []
  }
}

/** A section that only exists on one side: every leaf is an addition (or a removal). */
function wholeSectionDiff(section: ResumeSection, status: 'added' | 'removed'): SectionDiff {
  const diff = emptySectionDiff(section, status)
  const mark = status === 'added' ? allAdded : allRemoved
  const layout = section.layout
  switch (layout.kind) {
    case 'text':
      diff.text = status === 'added' ? { from: '', to: layout.body } : { from: layout.body, to: '' }
      break
    case 'entries':
      diff.entries = layout.entries.map((entry) => ({ id: entry.id, status, entry, fieldChanges: [], bullets: mark(entry.bullets) }))
      break
    case 'groups':
      diff.groups = layout.groups.map((group) => ({ id: group.id, status, group, labelChange: null, items: mark(group.items) }))
      break
    case 'list':
      diff.items = mark(layout.items)
      break
  }
  return diff
}

/**
 * Which shared sections are out of order. A section is "moved" when its rank
 * among the sections both sides have differs, so dropping a section in the
 * middle does not flag everything after it.
 */
function movedSectionIds(before: ResumeSection[], after: ResumeSection[]): Set<string> {
  const afterIds = new Set(after.map((section) => section.id))
  const beforeShared = before.map((section) => section.id).filter((id) => afterIds.has(id))
  const beforeIdSet = new Set(beforeShared)
  const afterShared = after.map((section) => section.id).filter((id) => beforeIdSet.has(id))
  const moved = new Set<string>()
  for (let index = 0; index < afterShared.length; index++) {
    if (beforeShared[index] !== afterShared[index]) moved.add(afterShared[index]!)
  }
  return moved
}

function diffSection(before: ResumeSection, after: ResumeSection, moved: boolean): SectionDiff {
  const diff = emptySectionDiff(after, 'unchanged')
  diff.moved = moved
  diff.titleChange = fieldChanges(before, after, ['title'])[0] ?? null
  let leafChanged = false
  if (before.layout.kind !== after.layout.kind) {
    diff.layoutChange = { from: before.layout.kind, to: after.layout.kind }
    const removed = wholeSectionDiff(before, 'removed')
    const added = wholeSectionDiff(after, 'added')
    diff.text = removed.text || added.text ? { from: removed.text?.from ?? '', to: added.text?.to ?? '' } : null
    diff.entries = [...added.entries, ...removed.entries]
    diff.groups = [...added.groups, ...removed.groups]
    diff.items = [...removed.items, ...added.items]
    leafChanged = true
  } else {
    switch (after.layout.kind) {
      case 'text': {
        const from = norm((before.layout as { body: string }).body)
        const to = norm(after.layout.body)
        diff.text = { from, to }
        leafChanged = from !== to
        break
      }
      case 'entries':
        diff.entries = diffEntries((before.layout as { entries: ResumeEntry[] }).entries, after.layout.entries)
        leafChanged = diff.entries.some((entry) => entry.status !== 'unchanged')
        break
      case 'groups':
        diff.groups = diffGroups((before.layout as { groups: ResumeGroup[] }).groups, after.layout.groups)
        leafChanged = diff.groups.some((group) => group.status !== 'unchanged')
        break
      case 'list':
        diff.items = diffStringLists((before.layout as { items: string[] }).items, after.layout.items)
        leafChanged = diff.items.some((change) => change.kind !== 'kept')
        break
    }
  }
  diff.status = statusOf(leafChanged || diff.titleChange !== null || moved)
  return diff
}

function countStrings(changes: StringChange[], summary: DiffSummary): void {
  for (const change of changes) {
    if (change.kind === 'added') summary.added++
    else if (change.kind === 'removed') summary.removed++
  }
}

function summarize(diff: Omit<ResumeDiff, 'summary'>): DiffSummary {
  const summary: DiffSummary = { added: 0, removed: 0, changed: 0 }
  summary.changed += diff.header.fieldChanges.length
  for (const contact of diff.header.contacts) {
    if (contact.status === 'added') summary.added++
    else if (contact.status === 'removed') summary.removed++
    else if (contact.status === 'changed') summary.changed++
  }
  for (const section of diff.sections) {
    if (section.titleChange || section.moved || section.layoutChange) summary.changed++
    if (section.text) {
      if (section.status === 'added') summary.added++
      else if (section.status === 'removed') summary.removed++
      else if (section.text.from !== section.text.to) summary.changed++
    }
    for (const entry of section.entries) {
      if (entry.status === 'added') summary.added++
      else if (entry.status === 'removed') summary.removed++
      else if (entry.fieldChanges.length > 0) summary.changed++
      countStrings(entry.bullets, summary)
    }
    for (const group of section.groups) {
      if (group.status === 'added') summary.added++
      else if (group.status === 'removed') summary.removed++
      else if (group.labelChange) summary.changed++
      countStrings(group.items, summary)
    }
    countStrings(section.items, summary)
  }
  return summary
}

export function diffResumeContent(master: ResumeContent, variant: ResumeContent): ResumeDiff {
  const masterById = new Map(master.sections.map((section) => [section.id, section]))
  const variantIds = new Set(variant.sections.map((section) => section.id))
  const moved = movedSectionIds(master.sections, variant.sections)

  const sections: SectionDiff[] = variant.sections.map((section) => {
    const original = masterById.get(section.id)
    return original ? diffSection(original, section, moved.has(section.id)) : wholeSectionDiff(section, 'added')
  })
  for (const section of master.sections) {
    if (!variantIds.has(section.id)) sections.push(wholeSectionDiff(section, 'removed'))
  }

  const header = {
    fieldChanges: fieldChanges(master.header, variant.header, ['fullName', 'headline']),
    contacts: diffContacts(master.header.contacts, variant.header.contacts)
  }
  const partial = { header, sections }
  return { ...partial, summary: summarize(partial) }
}

export function isDiffEmpty(diff: ResumeDiff): boolean {
  return diff.summary.added === 0 && diff.summary.removed === 0 && diff.summary.changed === 0
}

export interface UnknownResumeIds {
  entries: string[]
  groups: string[]
}

/**
 * Entry and group ids in the variant that the master does not have anywhere.
 * An entry is a job, degree or project and a group is a skill category: the
 * things an agent must never add on the user's behalf. Sections, contacts,
 * bullets and items are not checked; the agent is free to rephrase, drop,
 * reorder and regroup those.
 */
export function unknownResumeIds(master: ResumeContent, variant: ResumeContent): UnknownResumeIds {
  const masterEntryIds = new Set<string>()
  const masterGroupIds = new Set<string>()
  for (const section of master.sections) {
    if (section.layout.kind === 'entries') for (const entry of section.layout.entries) masterEntryIds.add(entry.id)
    if (section.layout.kind === 'groups') for (const group of section.layout.groups) masterGroupIds.add(group.id)
  }
  const unknown: UnknownResumeIds = { entries: [], groups: [] }
  for (const section of variant.sections) {
    if (section.layout.kind === 'entries') {
      for (const entry of section.layout.entries) if (!masterEntryIds.has(entry.id)) unknown.entries.push(entry.id)
    }
    if (section.layout.kind === 'groups') {
      for (const group of section.layout.groups) if (!masterGroupIds.has(group.id)) unknown.groups.push(group.id)
    }
  }
  return unknown
}

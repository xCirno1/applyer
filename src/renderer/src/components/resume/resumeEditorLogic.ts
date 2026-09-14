import type {
  ResumeContact,
  ResumeContent,
  ResumeEntry,
  ResumeGroup,
  ResumeHeader,
  ResumeSection,
  ResumeSectionLayout,
  ResumeSectionLayoutKind
} from '@shared/types/resume'
import { isSectionEmpty } from '@shared/resume/templates/shared'

/*
 * The plain-module half of `ResumeEditor`: every edit the form can make,
 * as a pure function from content to content. The component only wires
 * inputs to these, which is what keeps the rules (ids never change, a
 * layout only switches while the section is empty, moves clamp at the ends)
 * testable without mounting anything. Same split as
 * `workspace/workspaceLayout.ts` vs `useWorkspaceLayout.ts`.
 *
 * Ids are the contract with the diff and with `save_resume_variant`: an existing
 * section, entry or group keeps its id through any edit, and a new one gets
 * a fresh id that cannot collide with an agent-chosen one.
 */

export type MoveDirection = 'up' | 'down'

function randomSuffix(): string {
  const uuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}${Math.random()}`
  return uuid.replace(/-/g, '').slice(0, 8)
}

export function newResumeId(prefix: string): string {
  return `${prefix}-${randomSuffix()}`
}

export function moveItem<T>(items: readonly T[], index: number, direction: MoveDirection): T[] {
  const target = direction === 'up' ? index - 1 : index + 1
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return [...items]
  const next = [...items]
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved as T)
  return next
}

/** Multi-line editor value <-> string list. Blank lines are dropped; surrounding whitespace is trimmed. */
export function linesToList(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export function listToLines(items: readonly string[]): string {
  return items.join('\n')
}

export function updateHeader(content: ResumeContent, patch: Partial<Pick<ResumeHeader, 'fullName' | 'headline'>>): ResumeContent {
  const header = { ...content.header, ...patch }
  // An emptied headline is dropped rather than stored as '' so the template's
  // "no headline" branch applies, and the diff does not report '' vs undefined.
  if (header.headline !== undefined && header.headline.trim() === '') delete header.headline
  return { ...content, header }
}

export function addContact(content: ResumeContent): ResumeContent {
  const contact: ResumeContact = { id: newResumeId('contact'), label: '', value: '' }
  return { ...content, header: { ...content.header, contacts: [...content.header.contacts, contact] } }
}

export function updateContact(content: ResumeContent, id: string, patch: Partial<Omit<ResumeContact, 'id'>>): ResumeContent {
  return {
    ...content,
    header: {
      ...content.header,
      contacts: content.header.contacts.map((contact) => {
        if (contact.id !== id) return contact
        const next = { ...contact, ...patch }
        if (next.url !== undefined && next.url.trim() === '') delete next.url
        return next
      })
    }
  }
}

export function removeContact(content: ResumeContent, id: string): ResumeContent {
  return { ...content, header: { ...content.header, contacts: content.header.contacts.filter((contact) => contact.id !== id) } }
}

export function moveContact(content: ResumeContent, id: string, direction: MoveDirection): ResumeContent {
  const index = content.header.contacts.findIndex((contact) => contact.id === id)
  return { ...content, header: { ...content.header, contacts: moveItem(content.header.contacts, index, direction) } }
}

export function emptyLayout(kind: ResumeSectionLayoutKind): ResumeSectionLayout {
  switch (kind) {
    case 'text':
      return { kind: 'text', body: '' }
    case 'entries':
      return { kind: 'entries', entries: [] }
    case 'groups':
      return { kind: 'groups', groups: [] }
    case 'list':
      return { kind: 'list', items: [] }
  }
}

export function addSection(content: ResumeContent, kind: ResumeSectionLayoutKind, title = ''): ResumeContent {
  const section: ResumeSection = { id: newResumeId('section'), title, layout: emptyLayout(kind) }
  return { ...content, sections: [...content.sections, section] }
}

function mapSection(content: ResumeContent, id: string, update: (section: ResumeSection) => ResumeSection): ResumeContent {
  return { ...content, sections: content.sections.map((section) => (section.id === id ? update(section) : section)) }
}

export function updateSectionTitle(content: ResumeContent, id: string, title: string): ResumeContent {
  return mapSection(content, id, (section) => ({ ...section, title }))
}

export function removeSection(content: ResumeContent, id: string): ResumeContent {
  return { ...content, sections: content.sections.filter((section) => section.id !== id) }
}

export function moveSection(content: ResumeContent, id: string, direction: MoveDirection): ResumeContent {
  const index = content.sections.findIndex((section) => section.id === id)
  return { ...content, sections: moveItem(content.sections, index, direction) }
}

/**
 * Switching layout discards the body, so it is only allowed while there is
 * nothing to discard; a populated section is returned unchanged and the
 * editor disables the control (see `canChangeLayout`).
 */
export function canChangeLayout(section: ResumeSection): boolean {
  return isSectionEmpty(section)
}

export function changeSectionLayout(content: ResumeContent, id: string, kind: ResumeSectionLayoutKind): ResumeContent {
  return mapSection(content, id, (section) => {
    if (section.layout.kind === kind || !canChangeLayout(section)) return section
    return { ...section, layout: emptyLayout(kind) }
  })
}

export function updateTextBody(content: ResumeContent, sectionId: string, body: string): ResumeContent {
  return mapSection(content, sectionId, (section) =>
    section.layout.kind === 'text' ? { ...section, layout: { kind: 'text', body } } : section
  )
}

export function setListItems(content: ResumeContent, sectionId: string, items: string[]): ResumeContent {
  return mapSection(content, sectionId, (section) =>
    section.layout.kind === 'list' ? { ...section, layout: { kind: 'list', items } } : section
  )
}

function mapEntries(content: ResumeContent, sectionId: string, update: (entries: ResumeEntry[]) => ResumeEntry[]): ResumeContent {
  return mapSection(content, sectionId, (section) =>
    section.layout.kind === 'entries' ? { ...section, layout: { kind: 'entries', entries: update(section.layout.entries) } } : section
  )
}

export function addEntry(content: ResumeContent, sectionId: string): ResumeContent {
  return mapEntries(content, sectionId, (entries) => [...entries, { id: newResumeId('entry'), title: '', bullets: [] }])
}

/** Optional text fields emptied in the form are dropped, not stored as '', for the same reason as the headline. */
const OPTIONAL_ENTRY_FIELDS = ['subtitle', 'meta', 'start', 'end', 'url'] as const

export function updateEntry(
  content: ResumeContent,
  sectionId: string,
  entryId: string,
  patch: Partial<Omit<ResumeEntry, 'id'>>
): ResumeContent {
  return mapEntries(content, sectionId, (entries) =>
    entries.map((entry) => {
      if (entry.id !== entryId) return entry
      const next: ResumeEntry = { ...entry, ...patch }
      for (const field of OPTIONAL_ENTRY_FIELDS) {
        if (next[field] !== undefined && next[field]!.trim() === '') delete next[field]
      }
      return next
    })
  )
}

export function removeEntry(content: ResumeContent, sectionId: string, entryId: string): ResumeContent {
  return mapEntries(content, sectionId, (entries) => entries.filter((entry) => entry.id !== entryId))
}

export function moveEntry(content: ResumeContent, sectionId: string, entryId: string, direction: MoveDirection): ResumeContent {
  return mapEntries(content, sectionId, (entries) =>
    moveItem(
      entries,
      entries.findIndex((entry) => entry.id === entryId),
      direction
    )
  )
}

function mapGroups(content: ResumeContent, sectionId: string, update: (groups: ResumeGroup[]) => ResumeGroup[]): ResumeContent {
  return mapSection(content, sectionId, (section) =>
    section.layout.kind === 'groups' ? { ...section, layout: { kind: 'groups', groups: update(section.layout.groups) } } : section
  )
}

export function addGroup(content: ResumeContent, sectionId: string): ResumeContent {
  return mapGroups(content, sectionId, (groups) => [...groups, { id: newResumeId('group'), label: '', items: [] }])
}

export function updateGroup(
  content: ResumeContent,
  sectionId: string,
  groupId: string,
  patch: Partial<Omit<ResumeGroup, 'id'>>
): ResumeContent {
  return mapGroups(content, sectionId, (groups) => groups.map((group) => (group.id === groupId ? { ...group, ...patch } : group)))
}

export function removeGroup(content: ResumeContent, sectionId: string, groupId: string): ResumeContent {
  return mapGroups(content, sectionId, (groups) => groups.filter((group) => group.id !== groupId))
}

export function moveGroup(content: ResumeContent, sectionId: string, groupId: string, direction: MoveDirection): ResumeContent {
  return mapGroups(content, sectionId, (groups) =>
    moveItem(
      groups,
      groups.findIndex((group) => group.id === groupId),
      direction
    )
  )
}

/** Structural equality for the dirty flag; content is small and plain JSON, so a stringify compare is exact. */
export function isSameContent(a: ResumeContent, b: ResumeContent): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

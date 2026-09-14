import { describe, expect, it } from 'vitest'
import { SAMPLE_RESUME_CONTENT } from '@shared/resume/sampleContent'
import { validateResumeContent } from '@shared/resume/resumeContentSchema'
import type { ResumeContent } from '@shared/types/resume'
import {
  addContact,
  addEntry,
  addGroup,
  addSection,
  canChangeLayout,
  changeSectionLayout,
  isSameContent,
  linesToList,
  listToLines,
  moveEntry,
  moveItem,
  moveSection,
  newResumeId,
  removeEntry,
  removeSection,
  setListItems,
  updateContact,
  updateEntry,
  updateGroup,
  updateHeader,
  updateSectionTitle,
  updateTextBody
} from './resumeEditorLogic'

const base: ResumeContent = SAMPLE_RESUME_CONTENT

function section(content: ResumeContent, id: string): ResumeContent['sections'][number] {
  const found = content.sections.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`missing ${id}`)
  return found
}

describe('moveItem', () => {
  it('swaps neighbours and clamps at the ends', () => {
    expect(moveItem(['a', 'b', 'c'], 1, 'up')).toEqual(['b', 'a', 'c'])
    expect(moveItem(['a', 'b', 'c'], 1, 'down')).toEqual(['a', 'c', 'b'])
    expect(moveItem(['a', 'b', 'c'], 0, 'up')).toEqual(['a', 'b', 'c'])
    expect(moveItem(['a', 'b', 'c'], 2, 'down')).toEqual(['a', 'b', 'c'])
    expect(moveItem(['a'], -1, 'down')).toEqual(['a'])
  })
})

describe('lines <-> list', () => {
  it('drops blank lines and trims', () => {
    expect(linesToList(' a \n\n b\r\n  \nc')).toEqual(['a', 'b', 'c'])
    expect(listToLines(['a', 'b'])).toBe('a\nb')
  })
})

describe('ids', () => {
  it('generates short prefixed ids that pass validation', () => {
    const id = newResumeId('section')
    expect(id.startsWith('section-')).toBe(true)
    expect(id.length).toBeLessThanOrEqual(64)
    expect(newResumeId('x')).not.toBe(newResumeId('x'))
  })

  it('never changes existing ids through edits', () => {
    let content = updateSectionTitle(base, 's-experience', 'Work')
    content = updateEntry(content, 's-experience', 'e-1', { title: 'Lead' })
    content = updateGroup(content, 's-skills', 'g-1', { label: 'Tech' })
    content = updateContact(content, 'c-email', { value: 'x@y.z' })
    const ids = (value: ResumeContent): string[] => [
      ...value.header.contacts.map((contact) => contact.id),
      ...value.sections.flatMap((item) => [
        item.id,
        ...(item.layout.kind === 'entries' ? item.layout.entries.map((entry) => entry.id) : []),
        ...(item.layout.kind === 'groups' ? item.layout.groups.map((group) => group.id) : [])
      ])
    ]
    expect(ids(content)).toEqual(ids(base))
  })
})

describe('header and contacts', () => {
  it('drops an emptied headline and url instead of storing empty strings', () => {
    expect(updateHeader(base, { headline: '  ' }).header.headline).toBeUndefined()
    expect(updateHeader(base, { headline: 'Staff' }).header.headline).toBe('Staff')
    const cleared = updateContact(base, 'c-email', { url: '' })
    expect(cleared.header.contacts[0]!.url).toBeUndefined()
  })

  it('adds a contact with a fresh id', () => {
    const next = addContact(base)
    expect(next.header.contacts).toHaveLength(base.header.contacts.length + 1)
    expect(next.header.contacts.at(-1)!.id.startsWith('contact-')).toBe(true)
    expect(base.header.contacts).toHaveLength(4) // untouched input
  })
})

describe('sections', () => {
  it('adds, retitles, moves and removes sections without touching others', () => {
    let content = addSection(base, 'list', 'Awards')
    const added = content.sections.at(-1)!
    expect(added.layout).toEqual({ kind: 'list', items: [] })
    content = moveSection(content, added.id, 'up')
    expect(content.sections.at(-2)!.id).toBe(added.id)
    content = updateSectionTitle(content, added.id, 'Honours')
    expect(section(content, added.id).title).toBe('Honours')
    content = removeSection(content, added.id)
    expect(content.sections.map((item) => item.id)).toEqual(base.sections.map((item) => item.id))
  })

  it('only changes layout while the section is empty', () => {
    expect(canChangeLayout(section(base, 's-skills'))).toBe(false)
    expect(changeSectionLayout(base, 's-skills', 'list')).toEqual(base)
    let content = addSection(base, 'text')
    const id = content.sections.at(-1)!.id
    expect(canChangeLayout(section(content, id))).toBe(true)
    content = changeSectionLayout(content, id, 'entries')
    expect(section(content, id).layout).toEqual({ kind: 'entries', entries: [] })
    content = updateTextBody(content, id, 'ignored: not a text section')
    expect(section(content, id).layout.kind).toBe('entries')
  })

  it('edits text bodies and list items', () => {
    const text = updateTextBody(base, 's-summary', 'Short.')
    expect(section(text, 's-summary').layout).toEqual({ kind: 'text', body: 'Short.' })
    const list = setListItems(base, 's-certs', ['A', 'B'])
    expect(section(list, 's-certs').layout).toEqual({ kind: 'list', items: ['A', 'B'] })
  })
})

describe('entries and groups', () => {
  it('adds, edits, moves and removes entries', () => {
    let content = addEntry(base, 's-experience')
    const work = section(content, 's-experience')
    if (work.layout.kind !== 'entries') throw new Error('bad')
    const added = work.layout.entries.at(-1)!
    expect(added.bullets).toEqual([])
    content = updateEntry(content, 's-experience', added.id, { title: 'Intern', start: '2018', end: ' ' , bullets: ['Did things'] })
    const updated = (section(content, 's-experience').layout as { entries: { id: string; end?: string; start?: string; bullets: string[] }[] }).entries.at(-1)!
    expect(updated.start).toBe('2018')
    expect(updated.end).toBeUndefined()
    expect(updated.bullets).toEqual(['Did things'])
    content = moveEntry(content, 's-experience', added.id, 'up')
    expect((section(content, 's-experience').layout as { entries: { id: string }[] }).entries[1]!.id).toBe(added.id)
    content = removeEntry(content, 's-experience', added.id)
    expect((section(content, 's-experience').layout as { entries: unknown[] }).entries).toHaveLength(2)
  })

  it('adds and edits groups and ignores a wrong-layout section', () => {
    let content = addGroup(base, 's-skills')
    const skills = section(content, 's-skills')
    if (skills.layout.kind !== 'groups') throw new Error('bad')
    const added = skills.layout.groups.at(-1)!
    content = updateGroup(content, 's-skills', added.id, { label: 'Tools', items: ['Git'] })
    expect((section(content, 's-skills').layout as { groups: { label: string }[] }).groups.at(-1)!.label).toBe('Tools')
    expect(addGroup(base, 's-summary')).toEqual(base)
    expect(addEntry(base, 's-skills')).toEqual(base)
  })
})

describe('round trip', () => {
  it('edited content still validates, and equality detects edits', () => {
    const edited = updateTextBody(base, 's-summary', 'New summary.')
    expect(validateResumeContent(edited).ok).toBe(true)
    expect(isSameContent(base, structuredClone(base))).toBe(true)
    expect(isSameContent(base, edited)).toBe(false)
  })
})

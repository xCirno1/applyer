import { describe, expect, it } from 'vitest'
import type { ResumeContent, ResumeSection } from '../types/resume'
import { SAMPLE_RESUME_CONTENT } from './sampleContent'
import { diffResumeContent, diffStringLists, isDiffEmpty, unknownResumeIds } from './resumeDiff'

function clone(content: ResumeContent): ResumeContent {
  return structuredClone(content)
}

function section(content: ResumeContent, id: string): ResumeSection {
  const found = content.sections.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`missing section ${id}`)
  return found
}

describe('diffStringLists', () => {
  it('aligns kept items and reports a reword as remove + add', () => {
    expect(diffStringLists(['a', 'b', 'c'], ['a', 'B', 'c'])).toEqual([
      { kind: 'kept', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'B' },
      { kind: 'kept', text: 'c' }
    ])
  })

  it('ignores whitespace-only items and surrounding whitespace', () => {
    expect(diffStringLists([' a ', '  '], ['a'])).toEqual([{ kind: 'kept', text: 'a' }])
  })

  it('handles reorders as a removal and an addition', () => {
    const changes = diffStringLists(['a', 'b'], ['b', 'a'])
    expect(changes.filter((change) => change.kind === 'kept')).toHaveLength(1)
    expect(changes.filter((change) => change.kind !== 'kept')).toHaveLength(2)
  })
})

describe('diffResumeContent', () => {
  it('is empty for identical content', () => {
    const diff = diffResumeContent(SAMPLE_RESUME_CONTENT, clone(SAMPLE_RESUME_CONTENT))
    expect(isDiffEmpty(diff)).toBe(true)
    expect(diff.sections.every((item) => item.status === 'unchanged')).toBe(true)
    expect(diff.summary).toEqual({ added: 0, removed: 0, changed: 0 })
  })

  it('reports reworded and dropped bullets inside a matched entry', () => {
    const variant = clone(SAMPLE_RESUME_CONTENT)
    const work = section(variant, 's-experience')
    if (work.layout.kind !== 'entries') throw new Error('bad fixture')
    work.layout.entries[0]!.bullets = ['Designed the ledger service.', work.layout.entries[0]!.bullets[1]!]
    const diff = diffResumeContent(SAMPLE_RESUME_CONTENT, variant)
    const workDiff = diff.sections.find((item) => item.id === 's-experience')!
    expect(workDiff.status).toBe('changed')
    const entry = workDiff.entries.find((item) => item.id === 'e-1')!
    expect(entry.status).toBe('changed')
    expect(entry.bullets.filter((change) => change.kind === 'removed')).toHaveLength(2)
    expect(entry.bullets.filter((change) => change.kind === 'added')).toHaveLength(1)
    expect(entry.bullets.filter((change) => change.kind === 'kept')).toHaveLength(1)
    expect(diff.summary).toEqual({ added: 1, removed: 2, changed: 0 })
  })

  it('reports removed sections, added sections, and moved sections', () => {
    const variant = clone(SAMPLE_RESUME_CONTENT)
    variant.sections = variant.sections.filter((item) => item.id !== 's-certs')
    const skills = variant.sections.splice(variant.sections.findIndex((item) => item.id === 's-skills'), 1)[0]!
    variant.sections.splice(1, 0, skills)
    variant.sections.push({ id: 's-new', title: 'Interests', layout: { kind: 'list', items: ['Climbing', 'Chess'] } })

    const diff = diffResumeContent(SAMPLE_RESUME_CONTENT, variant)
    const byId = new Map(diff.sections.map((item) => [item.id, item]))
    expect(byId.get('s-certs')?.status).toBe('removed')
    expect(byId.get('s-certs')?.items.every((change) => change.kind === 'removed')).toBe(true)
    expect(byId.get('s-new')?.status).toBe('added')
    expect(byId.get('s-new')?.items.every((change) => change.kind === 'added')).toBe(true)
    expect(byId.get('s-skills')?.moved).toBe(true)
    expect(byId.get('s-summary')?.moved).toBe(false)
    // Sections come back in variant order with the removed one appended.
    expect(diff.sections.map((item) => item.id).at(-1)).toBe('s-certs')
    expect(diff.summary.added).toBe(2)
    expect(diff.summary.removed).toBe(2)
    expect(diff.summary.changed).toBeGreaterThanOrEqual(1)
  })

  it('reports a retitled section and changed entry fields', () => {
    const variant = clone(SAMPLE_RESUME_CONTENT)
    const work = section(variant, 's-experience')
    work.title = 'Relevant Experience'
    if (work.layout.kind !== 'entries') throw new Error('bad fixture')
    work.layout.entries[1]!.title = 'Backend Engineer'
    const diff = diffResumeContent(SAMPLE_RESUME_CONTENT, variant)
    const workDiff = diff.sections.find((item) => item.id === 's-experience')!
    expect(workDiff.titleChange).toEqual({ field: 'title', from: 'Experience', to: 'Relevant Experience' })
    const entry = workDiff.entries.find((item) => item.id === 'e-2')!
    expect(entry.fieldChanges).toEqual([{ field: 'title', from: 'Software Engineer', to: 'Backend Engineer' }])
    expect(diff.summary.changed).toBe(2)
  })

  it('treats a layout change as the whole section removed and re-added', () => {
    const variant = clone(SAMPLE_RESUME_CONTENT)
    const certs = section(variant, 's-certs')
    certs.layout = { kind: 'text', body: 'AWS SAA, CKA' }
    const diff = diffResumeContent(SAMPLE_RESUME_CONTENT, variant)
    const certsDiff = diff.sections.find((item) => item.id === 's-certs')!
    expect(certsDiff.layoutChange).toEqual({ from: 'list', to: 'text' })
    expect(certsDiff.items.every((change) => change.kind === 'removed')).toBe(true)
    expect(certsDiff.text).toEqual({ from: '', to: 'AWS SAA, CKA' })
  })

  it('diffs the header and contacts', () => {
    const variant = clone(SAMPLE_RESUME_CONTENT)
    variant.header.headline = 'Staff Engineer'
    variant.header.contacts = variant.header.contacts.filter((contact) => contact.id !== 'c-phone')
    variant.header.contacts[0]!.value = 'alex@example.com'
    const diff = diffResumeContent(SAMPLE_RESUME_CONTENT, variant)
    expect(diff.header.fieldChanges).toEqual([{ field: 'headline', from: 'Software Engineer', to: 'Staff Engineer' }])
    expect(diff.header.contacts.find((item) => item.id === 'c-phone')?.status).toBe('removed')
    expect(diff.header.contacts.find((item) => item.id === 'c-email')?.status).toBe('changed')
  })

  it('reports text body changes', () => {
    const variant = clone(SAMPLE_RESUME_CONTENT)
    const summary = section(variant, 's-summary')
    summary.layout = { kind: 'text', body: 'Payments engineer.' }
    const diff = diffResumeContent(SAMPLE_RESUME_CONTENT, variant)
    const summaryDiff = diff.sections.find((item) => item.id === 's-summary')!
    expect(summaryDiff.status).toBe('changed')
    expect(summaryDiff.text?.to).toBe('Payments engineer.')
    expect(diff.summary.changed).toBe(1)
  })
})

describe('unknownResumeIds', () => {
  it('is empty when the variant only reuses master ids', () => {
    const variant = clone(SAMPLE_RESUME_CONTENT)
    variant.sections.push({ id: 'new-section', title: 'Highlights', layout: { kind: 'list', items: ['x'] } })
    expect(unknownResumeIds(SAMPLE_RESUME_CONTENT, variant)).toEqual({ entries: [], groups: [] })
  })

  it('flags entries and groups the master never had, even inside a new section', () => {
    const variant = clone(SAMPLE_RESUME_CONTENT)
    variant.sections.push({
      id: 'new-section',
      title: 'Also worked at',
      layout: { kind: 'entries', entries: [{ id: 'invented', title: 'CTO', bullets: [] }] }
    })
    const skills = section(variant, 's-skills')
    if (skills.layout.kind !== 'groups') throw new Error('bad fixture')
    skills.layout.groups.push({ id: 'g-new', label: 'Leadership', items: ['Hiring'] })
    expect(unknownResumeIds(SAMPLE_RESUME_CONTENT, variant)).toEqual({ entries: ['invented'], groups: ['g-new'] })
  })

  it('allows moving an entry to a different section', () => {
    const variant = clone(SAMPLE_RESUME_CONTENT)
    const work = section(variant, 's-experience')
    const education = section(variant, 's-education')
    if (work.layout.kind !== 'entries' || education.layout.kind !== 'entries') throw new Error('bad fixture')
    education.layout.entries.push(work.layout.entries.pop()!)
    expect(unknownResumeIds(SAMPLE_RESUME_CONTENT, variant)).toEqual({ entries: [], groups: [] })
  })
})

import { describe, expect, it } from 'vitest'
import { RESUME_MAX_SECTIONS, RESUME_MAX_TEXT_CHARS } from '../constants'
import { isResumeContent, normalizeResumeContent, normalizeResumeFontSize, normalizeResumeStyle } from '../types/resume'
import { SAMPLE_RESUME_CONTENT } from './sampleContent'
import { duplicateResumeIds, resumeStyleSchema, validateResumeContent } from './resumeContentSchema'

describe('validateResumeContent', () => {
  it('accepts the sample content', () => {
    const result = validateResumeContent(SAMPLE_RESUME_CONTENT)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.content.sections).toHaveLength(SAMPLE_RESUME_CONTENT.sections.length)
  })

  it('trims strings on the way in', () => {
    const result = validateResumeContent({
      header: { fullName: '  Jane  ', contacts: [] },
      sections: [{ id: 's1', title: ' Summary ', layout: { kind: 'text', body: '  hi  ' } }]
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.content.header.fullName).toBe('Jane')
    expect(result.content.sections[0]?.title).toBe('Summary')
    expect(result.content.sections[0]?.layout).toEqual({ kind: 'text', body: 'hi' })
  })

  it('rejects a missing name, an unknown layout kind, and non-string bullets', () => {
    expect(validateResumeContent({ header: { fullName: '', contacts: [] }, sections: [] }).ok).toBe(false)
    expect(
      validateResumeContent({
        header: { fullName: 'A', contacts: [] },
        sections: [{ id: 's1', title: 'X', layout: { kind: 'table', rows: [] } }]
      }).ok
    ).toBe(false)
    expect(
      validateResumeContent({
        header: { fullName: 'A', contacts: [] },
        sections: [{ id: 's1', title: 'X', layout: { kind: 'entries', entries: [{ id: 'e1', title: 'T', bullets: [1] }] } }]
      }).ok
    ).toBe(false)
  })

  it('enforces the section count and text length limits', () => {
    const tooMany = {
      header: { fullName: 'A', contacts: [] },
      sections: Array.from({ length: RESUME_MAX_SECTIONS + 1 }, (_, index) => ({
        id: `s${index}`,
        title: 'X',
        layout: { kind: 'list', items: [] }
      }))
    }
    expect(validateResumeContent(tooMany).ok).toBe(false)
    const longBody = {
      header: { fullName: 'A', contacts: [] },
      sections: [{ id: 's1', title: 'X', layout: { kind: 'text', body: 'a'.repeat(RESUME_MAX_TEXT_CHARS + 1) } }]
    }
    expect(validateResumeContent(longBody).ok).toBe(false)
  })

  it('reports the failing path in the message', () => {
    const result = validateResumeContent({
      header: { fullName: 'A', contacts: [] },
      sections: [{ id: 's1', title: '', layout: { kind: 'list', items: [] } }]
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('sections.0.title')
  })

  it('rejects the same entry or group id in two different sections', () => {
    const entryTwice = {
      header: { fullName: 'A', contacts: [] },
      sections: [
        { id: 's1', title: 'Work', layout: { kind: 'entries', entries: [{ id: 'e1', title: 'One', bullets: [] }] } },
        { id: 's2', title: 'Projects', layout: { kind: 'entries', entries: [{ id: 'e1', title: 'Copy', bullets: [] }] } }
      ]
    }
    expect(duplicateResumeIds(entryTwice as never)).toEqual(['e1'])
    const groupTwice = {
      header: { fullName: 'A', contacts: [] },
      sections: [
        { id: 's1', title: 'Skills', layout: { kind: 'groups', groups: [{ id: 'g1', label: 'A', items: [] }] } },
        { id: 's2', title: 'Tools', layout: { kind: 'groups', groups: [{ id: 'g1', label: 'B', items: [] }] } }
      ]
    }
    expect(validateResumeContent(groupTwice).ok).toBe(false)
  })

  it('rejects duplicate ids within a list but allows the same id across different lists', () => {
    const duplicateEntries = {
      header: { fullName: 'A', contacts: [] },
      sections: [
        {
          id: 's1',
          title: 'Work',
          layout: {
            kind: 'entries',
            entries: [
              { id: 'same', title: 'One', bullets: [] },
              { id: 'same', title: 'Two', bullets: [] }
            ]
          }
        }
      ]
    }
    const result = validateResumeContent(duplicateEntries)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('same')

    const crossList = {
      header: { fullName: 'A', contacts: [{ id: 'x', label: 'Email', value: 'a@b.c' }] },
      sections: [{ id: 'x', title: 'Work', layout: { kind: 'entries', entries: [{ id: 'x', title: 'One', bullets: [] }] } }]
    }
    expect(validateResumeContent(crossList).ok).toBe(true)
    expect(duplicateResumeIds(SAMPLE_RESUME_CONTENT)).toEqual([])
  })
})

describe('isResumeContent / normalizeResumeContent', () => {
  it('accepts the sample and rejects non-objects and wrong shapes', () => {
    expect(isResumeContent(SAMPLE_RESUME_CONTENT)).toBe(true)
    expect(isResumeContent(null)).toBe(false)
    expect(isResumeContent({ header: { fullName: 1, contacts: [] }, sections: [] })).toBe(false)
    expect(isResumeContent({ header: { fullName: 'A', contacts: [] }, sections: [{ id: 's', title: 't', layout: { kind: 'nope' } }] })).toBe(false)
  })

  it('back-fills missing arrays and returns null for garbage', () => {
    expect(normalizeResumeContent({ header: { fullName: 'A' } })).toEqual({ header: { fullName: 'A', contacts: [] }, sections: [] })
    expect(normalizeResumeContent('resume')).toBeNull()
    expect(normalizeResumeContent({ header: { fullName: 'A' }, sections: 'none' })).toBeNull()
  })
})

describe('resume style', () => {
  it('normalizes untrusted style input field by field', () => {
    expect(normalizeResumeStyle(null)).toEqual({})
    expect(normalizeResumeStyle('georgia')).toEqual({})
    expect(normalizeResumeStyle({ fontFamily: 'georgia', fontSize: 10 })).toEqual({ fontFamily: 'georgia', fontSize: 10 })
    expect(normalizeResumeStyle({ fontFamily: 'comic', fontSize: '11.5', extra: true })).toEqual({ fontSize: 11.5 })
    expect(normalizeResumeStyle({ fontSize: Number.NaN })).toEqual({})
    expect(normalizeResumeStyle({ linkStyle: 'blue' })).toEqual({ linkStyle: 'blue' })
    expect(normalizeResumeStyle({ linkStyle: 'neon' })).toEqual({})
  })

  it('snaps font sizes to half points inside the allowed range', () => {
    expect(normalizeResumeFontSize(10.26)).toBe(10.5)
    expect(normalizeResumeFontSize(10.2)).toBe(10)
    expect(normalizeResumeFontSize(3)).toBe(8)
    expect(normalizeResumeFontSize(99)).toBe(14)
    expect(normalizeResumeFontSize('abc')).toBeUndefined()
    expect(normalizeResumeFontSize(undefined)).toBeUndefined()
  })

  it('the shared schema rejects what the picker cannot produce', () => {
    expect(resumeStyleSchema.safeParse({}).success).toBe(true)
    expect(resumeStyleSchema.safeParse({ fontFamily: 'times', fontSize: 9.5 }).success).toBe(true)
    expect(resumeStyleSchema.safeParse({ fontSize: 9.25 }).success).toBe(false)
    expect(resumeStyleSchema.safeParse({ fontSize: 20 }).success).toBe(false)
    expect(resumeStyleSchema.safeParse({ fontFamily: 'papyrus' }).success).toBe(false)
    expect(resumeStyleSchema.safeParse({ linkStyle: 'underline' }).success).toBe(true)
    expect(resumeStyleSchema.safeParse({ linkStyle: 'bold' }).success).toBe(false)
  })
})

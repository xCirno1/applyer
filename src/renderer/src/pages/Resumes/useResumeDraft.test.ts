import { describe, expect, it } from 'vitest'
import { SAMPLE_RESUME_CONTENT } from '@shared/resume/sampleContent'
import { nextResumeDraftEdits, resolveResumeDraft } from './useResumeDraft'

const edited = { ...SAMPLE_RESUME_CONTENT, header: { ...SAMPLE_RESUME_CONTENT.header, headline: 'Edited' } }
const other = { ...SAMPLE_RESUME_CONTENT, header: { ...SAMPLE_RESUME_CONTENT.header, fullName: 'Someone Else' } }

describe('resolveResumeDraft', () => {
  it('shows the edits only for the resume they were made against', () => {
    const edits = { identity: 'a', content: edited }
    expect(resolveResumeDraft(edits, SAMPLE_RESUME_CONTENT, 'a')).toEqual({ draft: edited, dirty: true })
    // Selecting B while A has edits shows B's stored content, clean, never A's typing.
    expect(resolveResumeDraft(edits, other, 'b')).toEqual({ draft: other, dirty: false })
    expect(resolveResumeDraft(null, other, 'b')).toEqual({ draft: other, dirty: false })
    expect(resolveResumeDraft(edits, null, 'b')).toEqual({ draft: null, dirty: false })
  })

  it('keeps the edits when the same resume is reselected', () => {
    const edits = { identity: 'a', content: edited }
    expect(resolveResumeDraft(edits, SAMPLE_RESUME_CONTENT, 'a').dirty).toBe(true)
  })
})

describe('nextResumeDraftEdits', () => {
  it('stamps an edit with the identity and drops it when it matches the source again', () => {
    expect(nextResumeDraftEdits(edited, SAMPLE_RESUME_CONTENT, 'a')).toEqual({ identity: 'a', content: edited })
    expect(nextResumeDraftEdits(structuredClone(SAMPLE_RESUME_CONTENT), SAMPLE_RESUME_CONTENT, 'a')).toBeNull()
    // No stored source to compare with: the edit stands.
    expect(nextResumeDraftEdits(edited, null, 'a')?.identity).toBe('a')
  })
})

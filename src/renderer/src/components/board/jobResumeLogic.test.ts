import { describe, it, expect } from 'vitest'
import type { JobAttachedResume } from '@shared/resume/attachedResume'
import { attachedNote, attachmentDiffersFromPlan, plannedResume, showsPlannedSentence } from './jobResumeLogic'

function record(overrides: Partial<JobAttachedResume> = {}): JobAttachedResume {
  return {
    source: 'variant',
    variantId: 'v1',
    variantName: 'Backend',
    templateId: 'modern',
    stale: false,
    attachedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('plannedResume', () => {
  it('prefers the assigned variant once a master exists', () => {
    expect(plannedResume('v1', true, 'original')).toEqual({ source: 'variant', variantId: 'v1' })
  })

  it('follows the fallback setting without a variant', () => {
    expect(plannedResume(null, true, 'master')).toEqual({ source: 'master', variantId: null })
    expect(plannedResume(null, true, 'original')).toEqual({ source: 'original', variantId: null })
  })

  it('is the original upload without a master, whatever else is set', () => {
    expect(plannedResume('v1', false, 'master')).toEqual({ source: 'original', variantId: null })
  })
})

describe('attachmentDiffersFromPlan', () => {
  it('matches the same variant and differs for another one', () => {
    expect(attachmentDiffersFromPlan(record(), { source: 'variant', variantId: 'v1' })).toBe(false)
    expect(attachmentDiffersFromPlan(record(), { source: 'variant', variantId: 'v2' })).toBe(true)
  })

  it('differs when the kind of resume changed', () => {
    expect(attachmentDiffersFromPlan(record(), { source: 'master', variantId: null })).toBe(true)
    expect(attachmentDiffersFromPlan(record({ source: 'original', variantId: null }), { source: 'master', variantId: null })).toBe(true)
    expect(attachmentDiffersFromPlan(record({ source: 'master', variantId: null }), { source: 'master', variantId: null })).toBe(false)
  })

  it('compares a variant record without an id by kind only', () => {
    expect(attachmentDiffersFromPlan(record({ variantId: null }), { source: 'variant', variantId: 'v9' })).toBe(false)
  })
})

describe('attachedNote', () => {
  it('says nothing when the attachment still matches', () => {
    expect(attachedNote('queued', false)).toBeNull()
    expect(attachedNote('submitted', false)).toBeNull()
  })

  it('distinguishes a refillable form from one already filled or sent', () => {
    expect(attachedNote('queued', true)).toBe('pendingChange')
    expect(attachedNote('filled', true)).toBe('alreadySent')
    expect(attachedNote('submitted', true)).toBe('alreadySent')
    expect(attachedNote('failed', true)).toBeNull()
  })
})

describe('showsPlannedSentence', () => {
  it('shows the plan until a settled application has its resume recorded', () => {
    expect(showsPlannedSentence('submitted', null)).toBe(true)
    expect(showsPlannedSentence('queued', record())).toBe(true)
    expect(showsPlannedSentence('failed', record())).toBe(true)
    expect(showsPlannedSentence('filled', record())).toBe(false)
    expect(showsPlannedSentence('submitted', record())).toBe(false)
  })
})

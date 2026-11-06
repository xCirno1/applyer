import { describe, it, expect } from 'vitest'
import { isResumeAttachmentPreference, normalizeAttachedResume } from './attachedResume'

const AT = '2026-03-01T10:00:00.000Z'

describe('normalizeAttachedResume', () => {
  it('keeps a well-formed variant record', () => {
    const record = { source: 'variant', variantId: 'v1', variantName: 'Backend', templateId: 'modern', stale: true, attachedAt: AT }
    expect(normalizeAttachedResume(record)).toEqual(record)
  })

  it('keeps master and original records and drops fields that do not belong to them', () => {
    expect(
      normalizeAttachedResume({ source: 'master', variantId: 'v1', variantName: 'Backend', templateId: 'classic', stale: true, attachedAt: AT })
    ).toEqual({ source: 'master', variantId: null, variantName: null, templateId: 'classic', stale: false, attachedAt: AT })
    expect(
      normalizeAttachedResume({ source: 'original', variantName: 'Backend', templateId: 'classic', attachedAt: AT })
    ).toEqual({ source: 'original', variantId: null, variantName: null, templateId: null, stale: false, attachedAt: AT })
  })

  it('normalizes the variant name and tolerates a missing or odd id', () => {
    expect(normalizeAttachedResume({ source: 'variant', variantName: '  Back   end ', attachedAt: AT })).toEqual({
      source: 'variant',
      variantId: null,
      variantName: 'Back end',
      templateId: null,
      stale: false,
      attachedAt: AT
    })
    expect(normalizeAttachedResume({ source: 'variant', variantId: 42, variantName: 'Backend', attachedAt: AT })?.variantId).toBeNull()
    expect(normalizeAttachedResume({ source: 'variant', variantId: 'x'.repeat(65), variantName: 'Backend', attachedAt: AT })?.variantId).toBeNull()
  })

  it('treats an unknown template as no template rather than rejecting the record', () => {
    expect(normalizeAttachedResume({ source: 'master', templateId: 'fancy', attachedAt: AT })?.templateId).toBeNull()
  })

  it('only counts a literal true as stale', () => {
    expect(normalizeAttachedResume({ source: 'variant', variantName: 'B', stale: 'yes', attachedAt: AT })?.stale).toBe(false)
  })

  it('rejects anything that is not a usable record', () => {
    expect(normalizeAttachedResume(null)).toBeNull()
    expect(normalizeAttachedResume(undefined)).toBeNull()
    expect(normalizeAttachedResume('variant')).toBeNull()
    expect(normalizeAttachedResume([])).toBeNull()
    expect(normalizeAttachedResume({ source: 'upload', attachedAt: AT })).toBeNull()
    expect(normalizeAttachedResume({ source: 'master' })).toBeNull()
    expect(normalizeAttachedResume({ source: 'master', attachedAt: 'not a date' })).toBeNull()
    expect(normalizeAttachedResume({ source: 'master', attachedAt: 12 })).toBeNull()
    expect(normalizeAttachedResume({ source: 'master', attachedAt: '' })).toBeNull()
  })

  it('rejects a variant record without a usable name', () => {
    expect(normalizeAttachedResume({ source: 'variant', attachedAt: AT })).toBeNull()
    expect(normalizeAttachedResume({ source: 'variant', variantName: '   ', attachedAt: AT })).toBeNull()
  })
})

describe('isResumeAttachmentPreference', () => {
  it('accepts the three choices and nothing else', () => {
    expect(['assigned', 'master', 'original'].every(isResumeAttachmentPreference)).toBe(true)
    expect(isResumeAttachmentPreference('variant')).toBe(false)
    expect(isResumeAttachmentPreference(undefined)).toBe(false)
  })
})

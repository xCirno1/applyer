// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_RESUMES_LAYOUT,
  DETAILS_MAX_PX,
  DETAILS_MIN_PX,
  LIST_MAX_PX,
  LIST_MIN_PX,
  RESUMES_LAYOUT_STORAGE_KEY,
  clampDetailsWidth,
  clampListWidth,
  parseResumesLayout,
  readStoredResumesLayout,
  writeStoredResumesLayout
} from './resumesLayout'

beforeEach(() => window.localStorage.clear())

describe('clampListWidth / clampDetailsWidth', () => {
  it('clamps to the fixed bounds without an available width', () => {
    expect(clampListWidth(50)).toBe(LIST_MIN_PX)
    expect(clampListWidth(5000)).toBe(LIST_MAX_PX)
    expect(clampDetailsWidth(50)).toBe(DETAILS_MIN_PX)
    expect(clampDetailsWidth(5000)).toBe(DETAILS_MAX_PX)
    expect(clampListWidth(300.4)).toBe(300)
  })

  it('leaves the middle column its minimum when both side columns are counted', () => {
    // 1000 wide, the other column 320: list may take at most 1000 - 320 - 360.
    expect(clampListWidth(400, 1000, 320)).toBe(320)
    expect(clampDetailsWidth(500, 1000, 288)).toBe(352)
  })

  it('never goes below its own minimum even when the row is too narrow', () => {
    expect(clampListWidth(300, 500, 320)).toBe(LIST_MIN_PX)
    expect(clampListWidth(Number.NaN)).toBe(LIST_MIN_PX)
  })
})

describe('parseResumesLayout', () => {
  it('returns the default for non-object input', () => {
    expect(parseResumesLayout(null)).toEqual(DEFAULT_RESUMES_LAYOUT)
    expect(parseResumesLayout([1])).toEqual(DEFAULT_RESUMES_LAYOUT)
  })

  it('falls back field by field and clamps what it keeps', () => {
    expect(parseResumesLayout({ listWidth: '250', detailsWidth: 'wide' })).toEqual({
      listWidth: 250,
      detailsWidth: DEFAULT_RESUMES_LAYOUT.detailsWidth
    })
    expect(parseResumesLayout({ listWidth: -1 }).listWidth).toBe(LIST_MIN_PX)
  })
})

describe('storage round-trip', () => {
  it('reads back what it wrote and survives bad JSON', () => {
    writeStoredResumesLayout({ listWidth: 260, detailsWidth: 400 })
    expect(readStoredResumesLayout()).toEqual({ listWidth: 260, detailsWidth: 400 })
    window.localStorage.setItem(RESUMES_LAYOUT_STORAGE_KEY, '{oops')
    expect(readStoredResumesLayout()).toEqual(DEFAULT_RESUMES_LAYOUT)
  })
})

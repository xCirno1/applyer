import { describe, expect, it } from 'vitest'
import { pageContentTop, pickBlockCandidates, planPageBreaks, previewTotalHeight, type PageGeometry } from './previewPagination'

// A 100px page with a 10px margin: 80px of content per page, sheets 5px apart.
const geometry: PageGeometry = { pageHeight: 100, margin: 10, gap: 5 }

describe('planPageBreaks', () => {
  it('leaves content that fits on one page alone', () => {
    const plan = planPageBreaks(
      [
        { top: 10, height: 30 },
        { top: 40, height: 30 }
      ],
      geometry
    )
    expect(plan).toEqual({ spacers: [], pageCount: 1 })
  })

  it('pushes a block that would straddle the page edge to the next page top', () => {
    const plan = planPageBreaks(
      [
        { top: 10, height: 60 },
        { top: 70, height: 30 }
      ],
      geometry
    )
    // Page 2 content starts at margin + page + gap = 115; the block sat at 70.
    expect(plan.spacers).toEqual([{ index: 1, height: 45 }])
    expect(plan.pageCount).toBe(2)
    expect(pageContentTop(1, geometry)).toBe(115)
  })

  it('accounts for earlier spacers when placing later blocks', () => {
    const plan = planPageBreaks(
      [
        { top: 10, height: 60 },
        { top: 70, height: 30 }, // pushed to 115..145
        { top: 100, height: 40 }, // now at 145..185, fits page 2 (ends 195)
        { top: 140, height: 40 } // now at 185..225, over 195: pushed to page 3 (220)
      ],
      geometry
    )
    expect(plan.spacers).toEqual([
      { index: 1, height: 45 },
      { index: 3, height: 35 }
    ])
    expect(plan.pageCount).toBe(3)
  })

  it('keeps a heading with the block after it', () => {
    const plan = planPageBreaks(
      [
        { top: 10, height: 60 },
        { top: 70, height: 10, keepWithNext: true },
        { top: 80, height: 30 }
      ],
      geometry
    )
    // The heading alone would fit (ends at 80 < 90) but its follower would not, so the heading moves too.
    expect(plan.spacers).toEqual([{ index: 1, height: 45 }])
    expect(plan.pageCount).toBe(2)
  })

  it('judges a heading alone when heading plus follower could never share a page', () => {
    const plan = planPageBreaks(
      [
        { top: 10, height: 10, keepWithNext: true },
        { top: 20, height: 150 }
      ],
      geometry
    )
    expect(plan.spacers).toEqual([])
    expect(plan.pageCount).toBe(2)
  })

  it('lets a block taller than a page span rather than looping', () => {
    const plan = planPageBreaks([{ top: 10, height: 250 }], geometry)
    expect(plan.spacers).toEqual([])
    expect(plan.pageCount).toBe(3)
  })

  it('judges the block after a spanning one against the page it actually starts on', () => {
    // The first block runs from page 0 into page 2's gap (bottom 215, page 1's
    // content ends at 195, page 2's starts at 220). The next block starts in
    // that gap and overruns page 1, so it moves forward onto page 2: a push
    // of +5, not the -90 that judging it against page 0 would give.
    const plan = planPageBreaks(
      [
        { top: 10, height: 205 },
        { top: 215, height: 20 }
      ],
      geometry
    )
    expect(plan.spacers).toEqual([{ index: 1, height: 5 }])
    expect(plan.pageCount).toBe(3)
  })

  it('never inserts a negative spacer', () => {
    const plan = planPageBreaks(
      [
        { top: 10, height: 300 },
        { top: 310, height: 10 },
        { top: 320, height: 60 }
      ],
      geometry
    )
    expect(plan.spacers.every((spacer) => spacer.height > 0)).toBe(true)
  })

  it('tolerates sub-pixel overrun at the page edge', () => {
    const plan = planPageBreaks([{ top: 10, height: 80.3 }], geometry)
    expect(plan.spacers).toEqual([])
    expect(plan.pageCount).toBe(1)
  })

  it('handles empty input and impossible geometry', () => {
    expect(planPageBreaks([], geometry)).toEqual({ spacers: [], pageCount: 1 })
    expect(planPageBreaks([{ top: 0, height: 10 }], { pageHeight: 10, margin: 10, gap: 0 })).toEqual({ spacers: [], pageCount: 1 })
  })
})

describe('pickBlockCandidates', () => {
  it('keeps a fitting entry whole and breaks an oversized one into its parts', () => {
    const fitting = [
      { id: 'entry', role: 'entry' as const, entryHeight: 60 },
      { id: 'head', role: 'entryPart' as const, entryHeight: 60 },
      { id: 'bullet', role: 'entryPart' as const, entryHeight: 60 }
    ]
    expect(pickBlockCandidates(fitting, 80).map((candidate) => candidate.id)).toEqual(['entry'])

    const oversized = fitting.map((candidate) => ({ ...candidate, entryHeight: 200 }))
    expect(pickBlockCandidates(oversized, 80).map((candidate) => candidate.id)).toEqual(['head', 'bullet'])
  })

  it('passes everything outside an entry through and tolerates a hair of overrun', () => {
    const candidates = [
      { id: 'heading', role: 'other' as const },
      { id: 'entry', role: 'entry' as const, entryHeight: 80.3 },
      { id: 'head', role: 'entryPart' as const, entryHeight: 80.3 },
      { id: 'group', role: 'other' as const }
    ]
    expect(pickBlockCandidates(candidates, 80).map((candidate) => candidate.id)).toEqual(['heading', 'entry', 'group'])
  })
})

describe('previewTotalHeight', () => {
  it('sums sheets and the gaps between them', () => {
    expect(previewTotalHeight(1, geometry)).toBe(100)
    expect(previewTotalHeight(3, geometry)).toBe(310)
  })
})

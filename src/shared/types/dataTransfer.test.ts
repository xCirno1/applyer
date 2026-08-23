import { describe, it, expect } from 'vitest'
import { allDomainsSelected, totalJsonBytes } from './dataTransfer'
import type { ExportSizes } from './dataTransfer'

function sizesFixture(): ExportSizes {
  return {
    jobs: { json: 100, csv: 50 },
    exclusions: { json: 40, csv: 20 },
    profile: { json: 30 },
    settings: { json: 10 },
    wrapperBytes: 60
  }
}

describe('totalJsonBytes', () => {
  it('is zero when nothing is selected', () => {
    expect(totalJsonBytes(sizesFixture(), { jobs: false, exclusions: false, profile: false, settings: false })).toBe(0)
  })

  it('needs no separator comma for a single selected domain', () => {
    const total = totalJsonBytes(sizesFixture(), { jobs: true, exclusions: false, profile: false, settings: false })
    expect(total).toBe(60 + 100) // wrapper + jobs, no comma
  })

  it('adds one comma byte per additional selected domain', () => {
    const total = totalJsonBytes(sizesFixture(), { jobs: true, exclusions: true, profile: false, settings: false })
    expect(total).toBe(60 + 100 + 40 + 1) // wrapper + jobs + exclusions + 1 separator comma
  })

  it('adds (domain count - 1) commas when all four are selected', () => {
    const total = totalJsonBytes(sizesFixture(), allDomainsSelected())
    expect(total).toBe(60 + 100 + 40 + 30 + 10 + 3) // wrapper + all four + 3 separator commas
  })
})

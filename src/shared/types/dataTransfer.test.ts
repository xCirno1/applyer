import { describe, it, expect } from 'vitest'
import { allDomainsSelected, totalJsonBytes } from './dataTransfer'
import type { ExportSizes } from './dataTransfer'

function sizesFixture(): ExportSizes {
  return {
    jobs: { json: 100, csv: 50 },
    exclusions: { json: 40, csv: 20 },
    companyBoards: { json: 25, csv: 15 },
    profile: { json: 30 },
    settings: { json: 10 },
    wrapperBytes: 60
  }
}

describe('totalJsonBytes', () => {
  it('is zero when nothing is selected', () => {
    expect(totalJsonBytes(sizesFixture(), allDomainsSelected(false))).toBe(0)
  })

  it('needs no separator comma for a single selected domain', () => {
    const total = totalJsonBytes(sizesFixture(), { ...allDomainsSelected(false), jobs: true })
    expect(total).toBe(60 + 100) // wrapper + jobs, no comma
  })

  it('adds one comma byte per additional selected domain', () => {
    const total = totalJsonBytes(sizesFixture(), { ...allDomainsSelected(false), jobs: true, exclusions: true })
    expect(total).toBe(60 + 100 + 40 + 1) // wrapper + jobs + exclusions + 1 separator comma
  })

  it('adds (domain count - 1) commas when every domain is selected', () => {
    const total = totalJsonBytes(sizesFixture(), allDomainsSelected())
    expect(total).toBe(60 + 100 + 40 + 25 + 30 + 10 + 4) // wrapper + all five + 4 separator commas
  })
})

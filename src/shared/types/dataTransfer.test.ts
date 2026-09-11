import { describe, it, expect } from 'vitest'
import { ALL_EXPORT_DOMAINS, allDomainsSelected, totalJsonBytes } from './dataTransfer'
import type { ExportSizes } from './dataTransfer'

describe('allDomainsSelected', () => {
  it('sets every domain in ALL_EXPORT_DOMAINS, including theme', () => {
    const selected = allDomainsSelected()
    for (const domain of ALL_EXPORT_DOMAINS) expect(selected[domain]).toBe(true)
    expect(allDomainsSelected(false).theme).toBe(false)
  })
})

function sizesFixture(): ExportSizes {
  return {
    jobs: { json: 100, csv: 50 },
    indexedJobs: { json: 70, csv: 35 },
    exclusions: { json: 40, csv: 20 },
    companyBoards: { json: 25, csv: 15 },
    profile: { json: 30 },
    settings: { json: 10 },
    theme: { json: 15 },
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
    expect(total).toBe(60 + 100 + 70 + 40 + 25 + 30 + 10 + 15 + 6) // wrapper + all seven + 6 separator commas
  })
})

import { describe, it, expect } from 'vitest'
import { parseJobPostingLd } from './jsonLd'

const posting = {
  '@context': 'https://schema.org',
  '@type': 'JobPosting',
  title: 'Backend Engineer',
  description: '<p>Build things.</p>',
  datePosted: '2026-09-01',
  hiringOrganization: { '@type': 'Organization', name: 'Acme Pty Ltd' },
  jobLocation: {
    '@type': 'Place',
    address: { '@type': 'PostalAddress', addressLocality: 'Sydney', addressRegion: 'NSW', addressCountry: 'AU' }
  },
  baseSalary: {
    '@type': 'MonetaryAmount',
    currency: 'AUD',
    value: { '@type': 'QuantitativeValue', minValue: 120000, maxValue: 140000, unitText: 'YEAR' }
  }
}

describe('parseJobPostingLd', () => {
  it('reads a plain JobPosting block', () => {
    expect(parseJobPostingLd([JSON.stringify(posting)])).toEqual({
      title: 'Backend Engineer',
      company: 'Acme Pty Ltd',
      location: 'Sydney, NSW, AU',
      descriptionHtml: '<p>Build things.</p>',
      datePosted: '2026-09-01',
      salary: 'AUD 120000-140000 / YEAR'
    })
  })

  it('finds the posting inside an array or a @graph', () => {
    const inArray = JSON.stringify([{ '@type': 'BreadcrumbList' }, posting])
    const inGraph = JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage' }, posting] })
    expect(parseJobPostingLd([inArray])?.title).toBe('Backend Engineer')
    expect(parseJobPostingLd([inGraph])?.title).toBe('Backend Engineer')
  })

  it('accepts @type given as an array', () => {
    const block = JSON.stringify({ ...posting, '@type': ['JobPosting', 'Thing'] })
    expect(parseJobPostingLd([block])?.company).toBe('Acme Pty Ltd')
  })

  it('skips a block that is not JSON and keeps looking', () => {
    expect(parseJobPostingLd(['{not json', JSON.stringify(posting)])?.title).toBe('Backend Engineer')
  })

  it('returns null when no block describes a JobPosting', () => {
    expect(parseJobPostingLd([JSON.stringify({ '@type': 'Organization', name: 'Acme' })])).toBeNull()
    expect(parseJobPostingLd([])).toBeNull()
    expect(parseJobPostingLd(['null', '42', '"x"'])).toBeNull()
  })

  it('drops fields of the wrong type instead of trusting them', () => {
    const block = JSON.stringify({
      '@type': 'JobPosting',
      title: 42,
      name: '  ',
      hiringOrganization: 'Acme',
      jobLocation: 'Melbourne',
      description: null,
      baseSalary: { currency: 'AUD', value: 'lots' }
    })
    expect(parseJobPostingLd([block])).toEqual({
      title: null,
      company: 'Acme',
      location: null,
      descriptionHtml: null,
      datePosted: null,
      salary: null
    })
  })

  it('takes the first of several locations and names a country given as an object', () => {
    const block = JSON.stringify({
      '@type': 'JobPosting',
      title: 'X',
      jobLocation: [
        { address: { addressLocality: 'Auckland', addressCountry: { '@type': 'Country', name: 'New Zealand' } } },
        { address: { addressLocality: 'Wellington' } }
      ]
    })
    expect(parseJobPostingLd([block])?.location).toBe('Auckland, New Zealand')
  })

  it('falls back to the place name when the address is empty', () => {
    const block = JSON.stringify({ '@type': 'JobPosting', title: 'X', jobLocation: { name: 'Remote' } })
    expect(parseJobPostingLd([block])?.location).toBe('Remote')
  })

  it('formats the salary shapes schema.org allows', () => {
    const salary = (baseSalary: unknown): string | null =>
      parseJobPostingLd([JSON.stringify({ '@type': 'JobPosting', title: 'X', baseSalary })])?.salary ?? null
    expect(salary('$80k')).toBe('$80k')
    expect(salary(90000)).toBe('90000')
    expect(salary({ currency: 'USD', value: { value: 90000 } })).toBe('USD 90000')
    expect(salary({ currency: 'USD', value: { minValue: 90000 } })).toBe('USD 90000+')
    expect(salary({ currency: 'USD', value: { maxValue: 90000, unitText: 'HOUR' } })).toBe('USD up to 90000 / HOUR')
    expect(salary({ currency: 'USD', minValue: 1, maxValue: 1 })).toBe('USD 1')
    expect(salary({ currency: 'USD' })).toBeNull()
  })
})

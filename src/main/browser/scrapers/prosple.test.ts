import { describe, it, expect } from 'vitest'
import { canonicalProspleJobUrl, companyFromEmployerSlug, prospleCardToResult } from './prosple'
import type { ProspleCard } from './dom/prosple'

function card(overrides: Partial<ProspleCard> = {}): ProspleCard {
  return {
    href: '/graduate-employers/deloitte-australia/jobs-internships/2027-graduate-program-audit?ref=search',
    title: '2027 Graduate Program, Audit',
    company: 'Deloitte Australia',
    location: 'Sydney',
    snippet: 'Audit the biggest companies.',
    closes: null,
    ...overrides
  }
}

describe('companyFromEmployerSlug', () => {
  it('capitalises each word of the slug', () => {
    expect(companyFromEmployerSlug('deloitte-australia')).toBe('Deloitte Australia')
    expect(companyFromEmployerSlug('kpmg')).toBe('Kpmg')
    expect(companyFromEmployerSlug('--')).toBe('')
  })
})

describe('canonicalProspleJobUrl', () => {
  it('keeps the employer/posting path and drops the query', () => {
    expect(canonicalProspleJobUrl(card().href, 'au.prosple.com')).toBe(
      'https://au.prosple.com/graduate-employers/deloitte-australia/jobs-internships/2027-graduate-program-audit'
    )
  })

  it('returns null for an employer profile or any other link', () => {
    expect(canonicalProspleJobUrl('/graduate-employers/deloitte-australia', 'au.prosple.com')).toBeNull()
    expect(canonicalProspleJobUrl('/search-jobs?keywords=x', 'au.prosple.com')).toBeNull()
  })
})

describe('prospleCardToResult', () => {
  it('maps a full card', () => {
    expect(prospleCardToResult(card({ closes: 'Closes 30 Sep 2026' }), 'au.prosple.com')).toEqual({
      title: '2027 Graduate Program, Audit',
      company: 'Deloitte Australia',
      location: 'Sydney',
      url: 'https://au.prosple.com/graduate-employers/deloitte-australia/jobs-internships/2027-graduate-program-audit',
      source: 'prosple',
      snippet: 'Audit the biggest companies. Closes: Closes 30 Sep 2026'
    })
  })

  it('derives the company from the employer slug when the card shows none', () => {
    const result = prospleCardToResult(card({ company: null }), 'au.prosple.com')
    expect(result?.company).toBe('Deloitte Australia')
  })

  it('drops a card without a title or a posting link', () => {
    expect(prospleCardToResult(card({ title: null }), 'au.prosple.com')).toBeNull()
    expect(prospleCardToResult(card({ href: '/graduate-employers/acme' }), 'au.prosple.com')).toBeNull()
  })
})

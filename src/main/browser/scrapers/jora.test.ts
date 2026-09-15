import { describe, it, expect } from 'vitest'
import { canonicalJoraJobUrl, joraCardToResult } from './jora'
import type { JoraCard } from './dom/jora'

const now = new Date('2026-09-14T10:00:00Z')

function card(overrides: Partial<JoraCard> = {}): JoraCard {
  return {
    href: '/job/Backend-Engineer-0a1b2c3d4e5f60718293a4b5c6d7e8f9?from_url=x&sp=serp',
    title: 'Backend Engineer',
    company: 'Acme',
    location: 'Melbourne VIC',
    snippet: 'Ship it.',
    salary: null,
    listed: null,
    ...overrides
  }
}

describe('canonicalJoraJobUrl', () => {
  it('resolves a relative posting link on the edition host and drops the tracking query', () => {
    expect(canonicalJoraJobUrl('/job/Backend-Engineer-abc?from_url=x', 'au.jora.com')).toBe(
      'https://au.jora.com/job/Backend-Engineer-abc'
    )
  })

  it('keeps the host of an absolute link', () => {
    expect(canonicalJoraJobUrl('https://nz.jora.com/job/X-1?sp=serp', 'au.jora.com')).toBe('https://nz.jora.com/job/X-1')
  })

  it('returns null for a link that is not a posting', () => {
    expect(canonicalJoraJobUrl('/jobs-in-Melbourne', 'au.jora.com')).toBeNull()
    expect(canonicalJoraJobUrl('http://[bad', 'au.jora.com')).toBeNull()
  })
})

describe('joraCardToResult', () => {
  it('maps a card to a result with the canonical URL', () => {
    expect(joraCardToResult(card({ listed: '2 days ago', salary: '$90k' }), 'au.jora.com', now)).toEqual({
      title: 'Backend Engineer',
      company: 'Acme',
      location: 'Melbourne VIC',
      url: 'https://au.jora.com/job/Backend-Engineer-0a1b2c3d4e5f60718293a4b5c6d7e8f9',
      source: 'jora',
      snippet: 'Ship it.',
      postedAt: '2026-09-12',
      salaryRange: '$90k'
    })
  })

  it('drops a card without a link, title or company', () => {
    expect(joraCardToResult(card({ href: null }), 'au.jora.com', now)).toBeNull()
    expect(joraCardToResult(card({ title: null }), 'au.jora.com', now)).toBeNull()
    expect(joraCardToResult(card({ company: null }), 'au.jora.com', now)).toBeNull()
    expect(joraCardToResult(card({ href: '/companies/acme' }), 'au.jora.com', now)).toBeNull()
  })
})

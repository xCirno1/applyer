import { describe, it, expect } from 'vitest'
import { hostToSlugCandidates, slugCandidates } from './slugCandidates'
import { MAX_SLUG_CANDIDATES } from '@shared/constants'

describe('hostToSlugCandidates', () => {
  it('takes the company label, not the functional subdomain', () => {
    expect(hostToSlugCandidates('careers.acme.com')).toEqual(['acme'])
    expect(hostToSlugCandidates('jobs.acme.com')).toEqual(['acme'])
    expect(hostToSlugCandidates('www.acme.com')).toEqual(['acme'])
  })

  it('handles a multi-part public suffix', () => {
    expect(hostToSlugCandidates('acme.co.uk')[0]).toBe('acme')
  })

  it('offers the second label as a fallback when there is an unknown prefix', () => {
    expect(hostToSlugCandidates('eu.acme.com')).toEqual(['eu', 'acme'])
  })

  it('falls back to the raw labels when every label is a functional word', () => {
    // Nothing is left after filtering, so the first raw label is the guess —
    // the second is the TLD and never worth probing.
    expect(hostToSlugCandidates('jobs.careers')).toEqual(['jobs'])
  })

  it('returns nothing usable for an empty hostname', () => {
    expect(hostToSlugCandidates('')).toEqual([])
  })
})

describe('slugCandidates', () => {
  it('derives joined, hyphenated and first-word guesses from a company name', () => {
    expect(slugCandidates('Acme Labs')).toEqual(['acmelabs', 'acme-labs', 'acme'])
  })

  it('drops a legal suffix, since a board slug never carries one', () => {
    expect(slugCandidates('Acme Inc.')).toEqual(['acme'])
    expect(slugCandidates('Acme Labs GmbH')).toEqual(['acmelabs', 'acme-labs', 'acme'])
  })

  it('never strips a name that is only a legal suffix', () => {
    expect(slugCandidates('Ltd')).toEqual(['ltd'])
  })

  it('writes "&" as "and", the way slugs usually do', () => {
    expect(slugCandidates('Ben & Jerry')).toEqual(['benandjerry', 'ben-and-jerry', 'ben'])
  })

  it('strips accents', () => {
    expect(slugCandidates('Nestlé')).toEqual(['nestle'])
  })

  it('uses the host alone for a URL, never the scheme or TLD', () => {
    expect(slugCandidates('https://careers.acme.com/openings')).toEqual(['acme'])
    expect(slugCandidates('acme.com')).toEqual(['acme'])
  })

  it('falls back to name handling for something that only looks like a domain', () => {
    expect(slugCandidates('Acme. Labs')).toEqual(['acmelabs', 'acme-labs', 'acme'])
  })

  it('returns nothing for input with no usable characters, so nothing is probed', () => {
    expect(slugCandidates('   ')).toEqual([])
    expect(slugCandidates('!')).toEqual([])
  })

  it('caps how many guesses are produced', () => {
    const candidates = slugCandidates('One Two Three Four Five Six Seven Eight')
    expect(candidates.length).toBeLessThanOrEqual(MAX_SLUG_CANDIDATES)
  })
})

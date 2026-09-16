import { describe, it, expect } from 'vitest'
import { canonicalSeekJobUrl, seekCardToResult } from './seek'
import type { SeekCard } from './dom/seek'

const now = new Date('2026-09-14T10:00:00Z')

function card(overrides: Partial<SeekCard> = {}): SeekCard {
  return {
    id: '81234567',
    title: 'Backend Engineer',
    company: 'Acme',
    location: 'Sydney NSW',
    snippet: 'Build things.',
    salary: null,
    listed: null,
    ...overrides
  }
}

describe('seekCardToResult', () => {
  it('builds the canonical posting URL on the searched host', () => {
    const result = seekCardToResult(card(), 'www.seek.co.nz', now)
    expect(result).toEqual({
      title: 'Backend Engineer',
      company: 'Acme',
      location: 'Sydney NSW',
      url: 'https://www.seek.co.nz/job/81234567',
      source: 'seek',
      snippet: 'Build things.'
    })
    expect(canonicalSeekJobUrl('www.seek.com.au', '1')).toBe('https://www.seek.com.au/job/1')
  })

  it('turns the listed-ago text into a date and carries the salary', () => {
    const result = seekCardToResult(card({ listed: '3d ago', salary: '$150k' }), 'www.seek.com.au', now)
    expect(result?.postedAt).toBe('2026-09-11')
    expect(result?.salaryRange).toBe('$150k')
  })

  it('leaves postedAt out when the listed text is not a duration', () => {
    const result = seekCardToResult(card({ listed: 'Featured' }), 'www.seek.com.au', now)
    expect(result).not.toHaveProperty('postedAt')
  })

  it('drops a card missing its id, title or company, or with an id that is not numeric', () => {
    expect(seekCardToResult(card({ id: null }), 'www.seek.com.au', now)).toBeNull()
    expect(seekCardToResult(card({ title: null }), 'www.seek.com.au', now)).toBeNull()
    expect(seekCardToResult(card({ company: null }), 'www.seek.com.au', now)).toBeNull()
    expect(seekCardToResult(card({ id: '../evil' }), 'www.seek.com.au', now)).toBeNull()
  })
})

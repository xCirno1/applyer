import { describe, it, expect } from 'vitest'
import { relativeListingDate } from './listingDate'

const now = new Date('2026-09-14T10:00:00Z')

describe('relativeListingDate', () => {
  it.each([
    ['3d ago', '2026-09-11'],
    ['1d ago', '2026-09-13'],
    ['2 days ago', '2026-09-12'],
    ['5h ago', '2026-09-14'],
    ['12 hours ago', '2026-09-13'],
    ['30 minutes ago', '2026-09-14'],
    ['1w ago', '2026-09-07'],
    ['2 weeks ago', '2026-08-31'],
    ['1mo ago', '2026-08-15'],
    ['Today', '2026-09-14'],
    ['Just posted', '2026-09-14'],
    ['Listed today', '2026-09-14'],
    ['Yesterday', '2026-09-13'],
    ['30+ days ago', '2026-08-15'],
    ['Listed 4d ago', '2026-09-10']
  ])('reads %s', (text, expected) => {
    expect(relativeListingDate(text, now)).toBe(expected)
  })

  it('returns null for anything it does not recognise instead of guessing', () => {
    expect(relativeListingDate('Closing soon', now)).toBeNull()
    expect(relativeListingDate('3 fortnights ago', now)).toBeNull()
    expect(relativeListingDate('', now)).toBeNull()
    expect(relativeListingDate(null, now)).toBeNull()
    expect(relativeListingDate(undefined, now)).toBeNull()
  })
})

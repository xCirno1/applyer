import { describe, it, expect } from 'vitest'
import { calendarDate, relativeListingDate } from './listingDate'

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

  it('reads the calendar day in the edition\'s zone, not UTC', () => {
    // 22:30 UTC on the 14th is already the 15th in Sydney and still the 14th in New York.
    const late = new Date('2026-09-14T22:30:00Z')
    expect(relativeListingDate('Today', late, 'Australia/Sydney')).toBe('2026-09-15')
    expect(relativeListingDate('Today', late, 'America/New_York')).toBe('2026-09-14')
    expect(relativeListingDate('Yesterday', late, 'Australia/Sydney')).toBe('2026-09-14')
    expect(relativeListingDate('3d ago', late, 'Australia/Sydney')).toBe('2026-09-12')
    expect(relativeListingDate('5h ago', late, 'Australia/Sydney')).toBe('2026-09-15')
    expect(relativeListingDate('Today', late)).toBe('2026-09-14')
  })

  it('falls back to UTC for a zone the runtime does not know rather than throwing', () => {
    expect(relativeListingDate('Today', now, 'Mars/Olympus_Mons')).toBe('2026-09-14')
  })

  it('returns null for anything it does not recognise instead of guessing', () => {
    expect(relativeListingDate('Closing soon', now)).toBeNull()
    expect(relativeListingDate('3 fortnights ago', now)).toBeNull()
    expect(relativeListingDate('', now)).toBeNull()
    expect(relativeListingDate(null, now)).toBeNull()
    expect(relativeListingDate(undefined, now)).toBeNull()
  })
})

describe('calendarDate', () => {
  it('formats as YYYY-MM-DD in the zone', () => {
    expect(calendarDate(new Date('2026-01-01T03:00:00Z'), 'Pacific/Auckland')).toBe('2026-01-01')
    expect(calendarDate(new Date('2025-12-31T23:30:00Z'), 'Pacific/Auckland')).toBe('2026-01-01')
    expect(calendarDate(new Date('2025-12-31T23:30:00Z'), 'America/Los_Angeles')).toBe('2025-12-31')
  })
})

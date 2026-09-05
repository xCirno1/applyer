import { describe, it, expect } from 'vitest'
import { utcDateString, dateStripLabel, fillDateStripDays } from './indexedJobsDateStrip'

const t = ((key: string) => (key === 'dateStrip.today' ? 'Today' : 'Yesterday')) as Parameters<
  typeof dateStripLabel
>[2]

describe('utcDateString', () => {
  it('returns today for offset 0', () => {
    expect(utcDateString(0, new Date('2026-03-15T12:00:00Z'))).toBe('2026-03-15')
  })

  it('rolls back across a month boundary', () => {
    expect(utcDateString(-1, new Date('2026-03-01T00:00:00Z'))).toBe('2026-02-28')
  })

  it('rolls back across a year boundary', () => {
    expect(utcDateString(-1, new Date('2026-01-01T00:00:00Z'))).toBe('2025-12-31')
  })

  it('is unaffected by the time-of-day component', () => {
    expect(utcDateString(0, new Date('2026-03-15T23:59:59Z'))).toBe('2026-03-15')
  })
})

describe('dateStripLabel', () => {
  const now = new Date('2026-03-15T12:00:00Z')

  it('labels the current UTC day as Today', () => {
    expect(dateStripLabel('2026-03-15', 'en-US', t, now).primary).toBe('Today')
  })

  it('labels the previous UTC day as Yesterday', () => {
    expect(dateStripLabel('2026-03-14', 'en-US', t, now).primary).toBe('Yesterday')
  })

  it('labels any other day with its short weekday name', () => {
    const label = dateStripLabel('2026-03-10', 'en-US', t, now)
    expect(label.primary).not.toBe('Today')
    expect(label.primary).not.toBe('Yesterday')
    expect(label.primary.length).toBeGreaterThan(0)
  })

  it('formats the secondary line as month + day, independent of local timezone', () => {
    expect(dateStripLabel('2026-03-10', 'en-US', t, now).secondary).toBe('Mar 10')
  })
})

describe('fillDateStripDays', () => {
  const now = new Date('2026-03-15T12:00:00Z')

  it('is empty with no buckets', () => {
    expect(fillDateStripDays([], now)).toEqual([])
  })

  it('fills the gap between buckets with zero-count days, newest first', () => {
    const result = fillDateStripDays(
      [
        { date: '2026-03-15', count: 3 },
        { date: '2026-03-12', count: 2 }
      ],
      now
    )

    expect(result).toEqual([
      { date: '2026-03-15', count: 3 },
      { date: '2026-03-14', count: 0 },
      { date: '2026-03-13', count: 0 },
      { date: '2026-03-12', count: 2 }
    ])
  })

  it('always anchors on today even when the newest bucket is older', () => {
    const result = fillDateStripDays([{ date: '2026-03-13', count: 1 }], now)
    expect(result[0]).toEqual({ date: '2026-03-15', count: 0 })
    expect(result.at(-1)).toEqual({ date: '2026-03-13', count: 1 })
  })

  it('falls back to the raw buckets when a date is malformed, instead of throwing', () => {
    const buckets = [
      { date: 'not-a-date', count: 1 },
      { date: '2026-03-12', count: 2 }
    ]
    expect(fillDateStripDays(buckets, now)).toEqual(buckets)
  })

  it('caps how many days a single gap can fill in', () => {
    const result = fillDateStripDays([{ date: '2020-01-01', count: 1 }], now)
    expect(result.length).toBeLessThanOrEqual(400)
  })
})

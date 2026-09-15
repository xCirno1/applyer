import { describe, it, expect } from 'vitest'
import { formatDuration, formatMillis, runDisplayName, sourceLabel } from './runFormat'

describe('formatDuration', () => {
  it.each([
    [0, '0s'],
    [999, '0s'],
    [12_000, '12s'],
    [65_000, '1m 05s'],
    [3_600_000, '1h 00m 00s'],
    [3_725_000, '1h 02m 05s'],
    [90_000_000, '25h 00m 00s'],
    [-5000, '0s'],
    [NaN, '0s'],
    [Infinity, '0s']
  ])('formats %s ms as %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected)
  })
})

describe('formatMillis', () => {
  it.each([
    [0, '0 ms'],
    [850, '850 ms'],
    [3200, '3.2 s'],
    [59_999, '60.0 s'],
    [65_000, '1m 05s'],
    [-1, '0 ms'],
    [NaN, '0 ms']
  ])('formats %s ms as %s', (ms, expected) => {
    expect(formatMillis(ms)).toBe(expected)
  })
})

describe('runDisplayName', () => {
  const defaultName = (sequence: number): string => `Run #${sequence}`

  it('prefers the label', () => {
    expect(runDisplayName({ label: 'Morning batch', sequence: 3 }, defaultName)).toBe('Morning batch')
  })

  it('falls back to the numbered default', () => {
    expect(runDisplayName({ label: null, sequence: 3 }, defaultName)).toBe('Run #3')
  })
})

describe('sourceLabel', () => {
  it('uses the brand name for a known source and the id otherwise', () => {
    expect(sourceLabel('seek')).toBe('Seek')
    expect(sourceLabel('linkedin')).toBe('LinkedIn')
    expect(sourceLabel('somewhere-new')).toBe('somewhere-new')
  })
})

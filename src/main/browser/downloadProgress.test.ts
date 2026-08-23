import { describe, it, expect } from 'vitest'
import { parseDownloadProgressLine } from './downloadProgress'

describe('parseDownloadProgressLine', () => {
  it('parses a percent and total size out of a progress line', () => {
    expect(parseDownloadProgressLine('|■■■■    |  40% of 390.2 MiB')).toEqual({ percent: 40, totalSize: '390.2 MiB' })
  })

  it('parses 0% and 100% correctly', () => {
    expect(parseDownloadProgressLine('|        |   0% of 2.3 MiB')).toEqual({ percent: 0, totalSize: '2.3 MiB' })
    expect(parseDownloadProgressLine('|■■■■■■■■| 100% of 2.3 MiB')).toEqual({ percent: 100, totalSize: '2.3 MiB' })
  })

  it('returns null for a line with no progress info', () => {
    expect(parseDownloadProgressLine('Downloading Chrome for Testing 151.0.7922.34\n')).toBeNull()
    expect(parseDownloadProgressLine('')).toBeNull()
  })

  it('matches within a larger chunk containing other text or newlines', () => {
    expect(parseDownloadProgressLine('some prefix\n|■■  |  20% of 114.7 MiB\nmore text')).toEqual({
      percent: 20,
      totalSize: '114.7 MiB'
    })
  })
})

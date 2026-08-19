import { describe, it, expect } from 'vitest'
import { detectSource, parseGreenhouseUrl, parseLeverUrl, parseAshbyUrl } from './sourceRouter'

describe('detectSource', () => {
  it.each([
    ['https://boards.greenhouse.io/acme/jobs/123', 'greenhouse'],
    ['https://job-boards.greenhouse.io/acme/jobs/123', 'greenhouse'],
    ['https://boards-api.greenhouse.io/v1/boards/acme/jobs/123', 'greenhouse'],
    ['https://jobs.lever.co/acme/abc-123', 'lever'],
    ['https://api.lever.co/v0/postings/acme/abc-123', 'lever'],
    ['https://jobs.ashbyhq.com/acme/abc-123', 'ashby'],
    ['https://api.ashbyhq.com/posting-api/job-board/acme', 'ashby'],
    ['https://acme.myworkdayjobs.com/careers/job/123', 'workday'],
    ['https://www.linkedin.com/jobs/view/123', 'linkedin'],
    ['https://linkedin.com/jobs/view/123', 'linkedin'],
    ['https://www.indeed.com/viewjob?jk=abc', 'indeed'],
    ['https://indeed.com/viewjob?jk=abc', 'indeed'],
    ['https://example.com/careers/123', 'generic'],
    ['https://boards.greenhouse.io.evil.com/acme/jobs/123', 'generic']
  ] as const)('classifies %s as %s', (url, expected) => {
    expect(detectSource(url)).toBe(expected)
  })

  it('returns generic for an unparseable URL rather than throwing', () => {
    expect(detectSource('not a url')).toBe('generic')
    expect(detectSource('')).toBe('generic')
  })

  it('is case-insensitive on hostname', () => {
    expect(detectSource('https://BOARDS.GREENHOUSE.IO/acme/jobs/123')).toBe('greenhouse')
  })
})

describe('parseGreenhouseUrl', () => {
  it('extracts token and numeric job id', () => {
    expect(parseGreenhouseUrl('https://boards.greenhouse.io/acme/jobs/123456')).toEqual({
      token: 'acme',
      jobId: '123456'
    })
  })

  it('works for the job-boards.* variant', () => {
    expect(parseGreenhouseUrl('https://job-boards.greenhouse.io/acme/jobs/999')).toEqual({
      token: 'acme',
      jobId: '999'
    })
  })

  it('returns null when the path does not match', () => {
    expect(parseGreenhouseUrl('https://boards.greenhouse.io/acme/about')).toBeNull()
    expect(parseGreenhouseUrl('https://boards.greenhouse.io/acme/jobs/abc')).toBeNull()
  })

  it('ignores query strings and trailing path segments', () => {
    expect(parseGreenhouseUrl('https://boards.greenhouse.io/acme/jobs/123?gh_src=x')).toEqual({
      token: 'acme',
      jobId: '123'
    })
  })
})

describe('parseLeverUrl', () => {
  const uuid = '11111111-2222-3333-4444-555555555555'

  it('extracts token and posting id', () => {
    expect(parseLeverUrl(`https://jobs.lever.co/acme/${uuid}`)).toEqual({ token: 'acme', postingId: uuid })
  })

  it('is case-insensitive on the hex portion of the uuid', () => {
    const upper = uuid.toUpperCase()
    expect(parseLeverUrl(`https://jobs.lever.co/acme/${upper}`)).toEqual({ token: 'acme', postingId: upper })
  })

  it('returns null when the posting id is not a valid uuid shape', () => {
    expect(parseLeverUrl('https://jobs.lever.co/acme/not-a-uuid')).toBeNull()
  })
})

describe('parseAshbyUrl', () => {
  const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

  it('extracts token and posting id', () => {
    expect(parseAshbyUrl(`https://jobs.ashbyhq.com/acme/${uuid}`)).toEqual({ token: 'acme', postingId: uuid })
  })

  it('returns null when the path is missing the posting id', () => {
    expect(parseAshbyUrl('https://jobs.ashbyhq.com/acme')).toBeNull()
  })
})

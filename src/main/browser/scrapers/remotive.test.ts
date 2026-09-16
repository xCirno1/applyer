import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

const fetchGenericJobDetails = vi.fn()
vi.mock('./generic', () => ({ fetchGenericJobDetails: (...args: unknown[]) => fetchGenericJobDetails(...args) }))

import {
  feedErrorTtlMs,
  fetchRemotiveJobDetails,
  parseRemotiveJobId,
  parseRemotiveJobs,
  rankByLocation,
  resetRemotiveFeedCache,
  searchRemotive,
  searchRemotiveFeed,
  type RemotiveJob
} from './remotive'

const originalFetch = global.fetch

beforeEach(() => {
  resetRemotiveFeedCache()
  fetchGenericJobDetails.mockReset()
})

afterEach(() => {
  global.fetch = originalFetch
  vi.useRealTimers()
})

function apiJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1234567,
    url: 'https://remotive.com/remote-jobs/software-dev/senior-backend-engineer-1234567',
    title: 'Senior Backend Engineer',
    company_name: 'Acme',
    category: 'Software Development',
    tags: ['go', 'postgres'],
    candidate_required_location: 'Worldwide',
    publication_date: '2026-09-10T08:00:00',
    salary: '$120k',
    description: '<p>Build &amp; ship <b>things</b>.</p>',
    ...overrides
  }
}

/** A well-formed response's jobs; the tests for the malformed case call `parseRemotiveJobs` directly. */
function feed(data: unknown): RemotiveJob[] {
  const jobs = parseRemotiveJobs(data)
  if (jobs === null) throw new Error('test feed is malformed')
  return jobs
}

function respondWith(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  global.fetch = spy as unknown as typeof fetch
  return spy
}

describe('parseRemotiveJobs', () => {
  it('reads well-formed postings and skips the rest', () => {
    const jobs = feed({
      jobs: [
        apiJob(),
        apiJob({ id: 'x' }),
        apiJob({ url: '' }),
        apiJob({ url: 'javascript:alert(1)' }),
        apiJob({ url: 'file:' + '//' + '/etc/hosts' }),
        apiJob({ url: '/remote-jobs/relative-1' }),
        apiJob({ title: null }),
        apiJob({ company_name: undefined }),
        'nonsense',
        apiJob({ id: 2, salary: '', candidate_required_location: null, description: 42, tags: 'go', category: 7 })
      ]
    })
    expect(jobs).toHaveLength(2)
    expect(jobs[0]).toEqual({
      id: 1234567,
      url: 'https://remotive.com/remote-jobs/software-dev/senior-backend-engineer-1234567',
      title: 'Senior Backend Engineer',
      company: 'Acme',
      category: 'Software Development',
      tags: ['go', 'postgres'],
      location: 'Worldwide',
      publishedAt: '2026-09-10T08:00:00',
      salary: '$120k',
      descriptionHtml: '<p>Build &amp; ship <b>things</b>.</p>'
    })
    expect(jobs[1]).toMatchObject({ id: 2, salary: null, location: null, descriptionHtml: '', tags: [], category: null })
  })

  it('tells a response of the wrong shape apart from an empty feed', () => {
    expect(parseRemotiveJobs(null)).toBeNull()
    expect(parseRemotiveJobs({ jobs: 'x' })).toBeNull()
    expect(parseRemotiveJobs([])).toBeNull()
    expect(parseRemotiveJobs({ error: 'rate limited' })).toBeNull()
    expect(parseRemotiveJobs({ jobs: [] })).toEqual([])
  })
})

describe('feedErrorTtlMs', () => {
  it('doubles from five minutes up to the ordinary TTL and stays there', () => {
    expect(feedErrorTtlMs(1)).toBe(5 * 60 * 1000)
    expect(feedErrorTtlMs(2)).toBe(10 * 60 * 1000)
    expect(feedErrorTtlMs(6)).toBe(160 * 60 * 1000)
    expect(feedErrorTtlMs(7)).toBe(320 * 60 * 1000)
    expect(feedErrorTtlMs(8)).toBe(6 * 60 * 60 * 1000)
    expect(feedErrorTtlMs(100)).toBe(6 * 60 * 60 * 1000)
    expect(feedErrorTtlMs(0)).toBe(5 * 60 * 1000)
  })
})

describe('rankByLocation', () => {
  const jobs = feed({
    jobs: [
      apiJob({ id: 1, candidate_required_location: 'USA only' }),
      apiJob({ id: 2, candidate_required_location: 'Australia' }),
      apiJob({ id: 3, candidate_required_location: 'Worldwide' }),
      apiJob({ id: 4, candidate_required_location: null })
    ]
  })

  it('puts postings open to the asked-for place first and keeps the order within each group', () => {
    expect(rankByLocation(jobs, 'Australia').map((job) => job.id)).toEqual([2, 3, 4, 1])
  })

  it('leaves the order alone with no location', () => {
    expect(rankByLocation(jobs, undefined).map((job) => job.id)).toEqual([1, 2, 3, 4])
    expect(rankByLocation(jobs, '   ').map((job) => job.id)).toEqual([1, 2, 3, 4])
  })
})

describe('searchRemotiveFeed', () => {
  const jobs = feed({
    jobs: [
      apiJob({ id: 1, title: 'Marketing Manager', category: 'Marketing', tags: ['seo'] }),
      apiJob({ id: 2, title: 'Backend Engineer', category: 'Software Development', tags: ['go'] }),
      apiJob({ id: 3, title: 'Product Designer', category: 'Design', tags: ['figma', 'backend systems'] }),
      apiJob({ id: 4, title: 'Backend Engineer (Go)', candidate_required_location: 'Australia' })
    ]
  })

  it('matches the query against title, category and tags, title hits first', () => {
    expect(searchRemotiveFeed(jobs, 'backend', undefined).map((job) => job.id)).toEqual([2, 4, 3])
  })

  it('returns nothing when no posting matches every term', () => {
    expect(searchRemotiveFeed(jobs, 'backend marketing', undefined)).toEqual([])
  })

  it('applies the location preference after ranking', () => {
    expect(searchRemotiveFeed(jobs, 'backend', 'Australia').map((job) => job.id)).toEqual([2, 4, 3])
    expect(searchRemotiveFeed(jobs, 'backend', 'USA').map((job) => job.id)).toEqual([2, 3, 4])
    const usOnly = feed({
      jobs: [apiJob({ id: 5, title: 'Backend', candidate_required_location: 'USA only' }), apiJob({ id: 6, title: 'Backend' })]
    })
    expect(searchRemotiveFeed(usOnly, 'backend', 'Europe').map((job) => job.id)).toEqual([6, 5])
  })
})

describe('searchRemotive', () => {
  it('downloads the whole feed once and answers from it', async () => {
    const spy = respondWith({ jobs: [apiJob()] })

    const outcome = await searchRemotive({ query: 'backend engineer', limit: 10, country: 'us' })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]?.[0]).toBe('https://remotive.com/api/remote-jobs')
    expect(outcome).toEqual({
      results: [
        {
          title: 'Senior Backend Engineer',
          company: 'Acme',
          location: 'Worldwide',
          url: 'https://remotive.com/remote-jobs/software-dev/senior-backend-engineer-1234567',
          source: 'remotive',
          snippet: 'Build & ship things.',
          postedAt: '2026-09-10T08:00:00',
          salaryRange: '$120k'
        }
      ],
      blocked: false
    })

    await searchRemotive({ query: 'designer', limit: 10, country: 'us' })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('shares one download between concurrent searches', async () => {
    const spy = respondWith({ jobs: [apiJob()] })
    await Promise.all([
      searchRemotive({ query: 'backend', limit: 10, country: 'us' }),
      searchRemotive({ query: 'engineer', limit: 10, country: 'au' })
    ])
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('refreshes the feed once it is older than the TTL', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-14T00:00:00Z'))
    const spy = respondWith({ jobs: [apiJob()] })
    await searchRemotive({ query: 'backend', limit: 10, country: 'us' })
    vi.setSystemTime(new Date('2026-09-14T05:00:00Z'))
    await searchRemotive({ query: 'backend', limit: 10, country: 'us' })
    expect(spy).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date('2026-09-14T06:00:01Z'))
    await searchRemotive({ query: 'backend', limit: 10, country: 'us' })
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('cuts to the limit after ranking', async () => {
    respondWith({ jobs: [apiJob({ id: 1 }), apiJob({ id: 2 }), apiJob({ id: 3 })] })
    const outcome = await searchRemotive({ query: 'backend', limit: 2, country: 'us' })
    expect(outcome.results).toHaveLength(2)
  })

  it('labels a posting with no required location as Remote', async () => {
    respondWith({ jobs: [apiJob({ candidate_required_location: null })] })
    const outcome = await searchRemotive({ query: 'backend', limit: 2, country: 'us' })
    expect(outcome.results[0]?.location).toBe('Remote')
  })

  it('returns a warning rather than throwing when the API fails, and retries sooner than a good feed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-14T00:00:00Z'))
    const spy = respondWith({}, 500)
    const outcome = await searchRemotive({ query: 'x', limit: 2, country: 'us' })
    expect(outcome.results).toEqual([])
    expect(outcome.warning).toMatch(/^remotive: /)

    await searchRemotive({ query: 'x', limit: 2, country: 'us' })
    expect(spy).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date('2026-09-14T00:05:01Z'))
    await searchRemotive({ query: 'x', limit: 2, country: 'us' })
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('waits longer after each failure in a row, so a broken endpoint is not called per search', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-14T00:00:00Z'))
    const spy = respondWith({}, 500)
    await searchRemotive({ query: 'x', limit: 2, country: 'us' })
    vi.setSystemTime(new Date('2026-09-14T00:05:01Z'))
    await searchRemotive({ query: 'x', limit: 2, country: 'us' })
    expect(spy).toHaveBeenCalledTimes(2)
    // Five more minutes is no longer enough after the second failure.
    vi.setSystemTime(new Date('2026-09-14T00:10:02Z'))
    await searchRemotive({ query: 'x', limit: 2, country: 'us' })
    expect(spy).toHaveBeenCalledTimes(2)
    vi.setSystemTime(new Date('2026-09-14T00:15:02Z'))
    await searchRemotive({ query: 'x', limit: 2, country: 'us' })
    expect(spy).toHaveBeenCalledTimes(3)
  })

  it('resets the backoff once the feed loads again', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-14T00:00:00Z'))
    const spy = respondWith({}, 500)
    await searchRemotive({ query: 'x', limit: 2, country: 'us' })
    vi.setSystemTime(new Date('2026-09-14T00:05:01Z'))
    respondWith({ jobs: [apiJob()] })
    const good = await searchRemotive({ query: 'backend', limit: 2, country: 'us' })
    expect(good.results).toHaveLength(1)
    expect(spy).toHaveBeenCalledTimes(1)
    // A good feed is kept for the ordinary six hours, not retried on the error clock.
    vi.setSystemTime(new Date('2026-09-14T03:00:00Z'))
    await searchRemotive({ query: 'backend', limit: 2, country: 'us' })
    vi.setSystemTime(new Date('2026-09-14T06:05:02Z'))
    respondWith({}, 500)
    const failedAgain = await searchRemotive({ query: 'backend', limit: 2, country: 'us' })
    expect(failedAgain.warning).toMatch(/^remotive: /)
    // First failure after a success: back to the five-minute wait.
    vi.setSystemTime(new Date('2026-09-14T06:10:03Z'))
    const retrySpy = respondWith({ jobs: [apiJob()] })
    await searchRemotive({ query: 'backend', limit: 2, country: 'us' })
    expect(retrySpy).toHaveBeenCalledTimes(1)
  })

  it('treats a successful answer without a jobs list as a failure, not an empty feed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-14T00:00:00Z'))
    const spy = respondWith({ error: 'rate limited' })
    const outcome = await searchRemotive({ query: 'x', limit: 2, country: 'us' })
    expect(outcome.results).toEqual([])
    expect(outcome.warning).toMatch(/unexpected shape/)
    // Retried on the error clock, not kept for six hours.
    vi.setSystemTime(new Date('2026-09-14T00:05:01Z'))
    await searchRemotive({ query: 'x', limit: 2, country: 'us' })
    expect(spy).toHaveBeenCalledTimes(2)
  })
})

describe('parseRemotiveJobId', () => {
  it('reads the trailing id from the slug', () => {
    expect(parseRemotiveJobId('https://remotive.com/remote-jobs/software-dev/senior-backend-engineer-1234567')).toBe(
      1234567
    )
    expect(parseRemotiveJobId('https://remotive.com/remote-jobs/software-dev/senior-backend-engineer-1234567/')).toBe(
      1234567
    )
  })

  it('returns null for a URL that is not a posting', () => {
    expect(parseRemotiveJobId('https://remotive.com/remote-jobs/software-dev')).toBeNull()
    expect(parseRemotiveJobId('https://remotive.com/')).toBeNull()
    expect(parseRemotiveJobId('not a url')).toBeNull()
  })
})

describe('fetchRemotiveJobDetails', () => {
  it('finds the posting by id in the cached feed and returns its full description', async () => {
    respondWith({ jobs: [apiJob({ id: 1 }), apiJob()] })
    const outcome = await fetchRemotiveJobDetails(
      'https://remotive.com/remote-jobs/software-dev/senior-backend-engineer-1234567'
    )
    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') throw new Error('unreachable')
    expect(outcome.details).toMatchObject({
      title: 'Senior Backend Engineer',
      company: 'Acme',
      location: 'Worldwide',
      descriptionText: 'Build & ship things.',
      detectedAts: 'remotive',
      applyMethod: 'external_form',
      salaryRange: '$120k'
    })
    expect(fetchGenericJobDetails).not.toHaveBeenCalled()
  })

  it('falls back to reading the page when the feed does not have the posting', async () => {
    respondWith({ jobs: [apiJob({ id: 1 })] })
    fetchGenericJobDetails.mockResolvedValue({ status: 'not_found', message: 'gone' })
    const url = 'https://remotive.com/remote-jobs/software-dev/senior-backend-engineer-1234567'
    const outcome = await fetchRemotiveJobDetails(url)
    expect(fetchGenericJobDetails).toHaveBeenCalledWith(url)
    expect(outcome).toEqual({ status: 'not_found', message: 'gone' })
  })

  it('falls back to the page without touching the API for a URL with no posting id', async () => {
    const spy = respondWith({ jobs: [] })
    fetchGenericJobDetails.mockResolvedValue({ status: 'not_found', message: 'gone' })
    await fetchRemotiveJobDetails('https://remotive.com/remote-companies/acme')
    expect(spy).not.toHaveBeenCalled()
    expect(fetchGenericJobDetails).toHaveBeenCalled()
  })
})

import { describe, it, expect, vi, afterEach } from 'vitest'
import { greenhouseAdapter } from './greenhouse'
import { leverAdapter } from './lever'
import { ashbyAdapter } from './ashby'
import { workdayAdapter } from './workday'
import { boardKeyOf, isValidBoardDescriptor, parseAnyBoardUrl } from './index'
import type { AtsBoardDescriptor } from '@shared/types/companyBoard'

/** Signature the spies are typed against, so `mock.calls[n][1]` is the request init rather than `never`. */
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

const originalFetch = global.fetch

afterEach(() => {
  global.fetch = originalFetch
})

function respond(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
}

const slugBoard = (provider: 'greenhouse' | 'lever' | 'ashby', token: string): AtsBoardDescriptor => ({
  provider,
  token,
  host: null,
  site: null
})

const options = { query: 'engineer', limit: 20, companyName: 'Acme' }

describe('greenhouseAdapter.fetchBoard', () => {
  it('asks for pay transparency but not content, and maps the response', async () => {
    const fetchSpy = vi.fn<FetchLike>(async () =>
      respond({
        jobs: [
          {
            id: 4461450008,
            title: 'Account Executive',
            absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/4461450008',
            location: { name: 'New York City, NY' },
            company_name: 'Acme Inc',
            first_published: '2026-08-01T13:53:38-05:00',
            updated_at: '2026-08-21T21:32:54-04:00',
            pay_input_ranges: [
              { min_cents: 22280000, max_cents: 29000000, currency_type: 'USD', title: 'Annual Salary:' }
            ]
          }
        ],
        meta: { total: 1 }
      })
    )
    global.fetch = fetchSpy as unknown as typeof fetch

    const outcome = await greenhouseAdapter.fetchBoard(slugBoard('greenhouse', 'acme'), options)

    const url = fetchSpy.mock.calls[0]![0]
    expect(url).toBe('https://boards-api.greenhouse.io/v1/boards/acme/jobs?pay_transparency=true')
    // content=true costs ~9MB on a large board and buys a description search
    // doesn't use; get_job_details fetches the single posting instead.
    expect(url).not.toContain('content=true')

    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') throw new Error('unreachable')
    expect(outcome.postings).toHaveLength(1)
    const job = outcome.postings[0]!
    expect(job.id).toBe('4461450008')
    expect(job.company).toBe('Acme Inc')
    expect(job.location).toBe('New York City, NY')
    expect(job.url).toBe('https://job-boards.greenhouse.io/acme/jobs/4461450008')
    expect(job.postedAt).toBe('2026-08-01T18:53:38.000Z')
    // Amounts are integer cents, and the employer's own free-text period
    // label is carried across (minus its trailing colon) rather than being
    // interpreted — "Hourly Base Pay Range:" appears on the same boards.
    expect(job.salaryRange).toBe('$222,800 – $290,000 (Annual Salary)')
  })

  it('falls back to the tracked company name when the payload omits one', async () => {
    global.fetch = vi.fn(async () =>
      respond({ jobs: [{ id: 1, title: 'Role', absolute_url: 'https://boards.greenhouse.io/acme/jobs/1' }] })
    ) as typeof fetch

    const outcome = await greenhouseAdapter.fetchBoard(slugBoard('greenhouse', 'acme'), options)
    if (outcome.status !== 'ok') throw new Error('unreachable')
    expect(outcome.postings[0]!.company).toBe('Acme')
    expect(outcome.postings[0]!.salaryRange).toBeUndefined()
  })

  it('builds a canonical URL when the board is served from a custom domain', async () => {
    global.fetch = vi.fn(async () =>
      respond({ jobs: [{ id: 7, title: 'Role', absolute_url: 'https://careers.acme.com/jobs/7' }] })
    ) as typeof fetch

    const outcome = await greenhouseAdapter.fetchBoard(slugBoard('greenhouse', 'acme'), options)
    if (outcome.status !== 'ok') throw new Error('unreachable')
    // Keeps get_job_details on the public API rather than the browser scraper.
    expect(outcome.postings[0]!.url).toBe('https://job-boards.greenhouse.io/acme/jobs/7')
  })

  it('skips unreadable rows instead of emitting half a posting', async () => {
    global.fetch = vi.fn(async () =>
      respond({ jobs: [null, { title: 'No id' }, { id: 2 }, { id: 3, title: 'Good', absolute_url: 'x' }] })
    ) as typeof fetch

    const outcome = await greenhouseAdapter.fetchBoard(slugBoard('greenhouse', 'acme'), options)
    if (outcome.status !== 'ok') throw new Error('unreachable')
    expect(outcome.postings.map((p) => p.id)).toEqual(['3'])
    expect(outcome.skipped).toBe(3)
  })

  it('distinguishes a 404 (wrong slug) from a live board with nothing open', async () => {
    global.fetch = vi.fn(async () => respond('', 404)) as typeof fetch
    expect(await greenhouseAdapter.fetchBoard(slugBoard('greenhouse', 'nope'), options)).toEqual({
      status: 'not_found'
    })

    global.fetch = vi.fn(async () => respond({ jobs: [] })) as typeof fetch
    expect(await greenhouseAdapter.fetchBoard(slugBoard('greenhouse', 'quiet'), options)).toEqual({
      status: 'ok',
      postings: [],
      skipped: 0
    })
  })

  it('reports a response with no jobs array as an error, not an empty board', async () => {
    global.fetch = vi.fn(async () => respond({ error: 'nope' })) as typeof fetch
    const outcome = await greenhouseAdapter.fetchBoard(slugBoard('greenhouse', 'acme'), options)
    expect(outcome.status).toBe('error')
  })
})

describe('leverAdapter.fetchBoard', () => {
  it('maps a bare array of postings, filling in the company name itself', async () => {
    global.fetch = vi.fn(async () =>
      respond([
        {
          id: 'a0fa7da3-4c3c-4fa2-97bd-7d6eb01eb9e5',
          text: 'Android Engineer',
          categories: { location: 'New York, NY', department: 'Engineering', team: 'Ads', commitment: 'Permanent' },
          workplaceType: 'remote',
          createdAt: 1773857225234,
          descriptionPlain: 'Our mission on the Advertising team is to build things.',
          hostedUrl: 'https://jobs.lever.co/acme/a0fa7da3-4c3c-4fa2-97bd-7d6eb01eb9e5'
        }
      ])
    ) as typeof fetch

    const outcome = await leverAdapter.fetchBoard(slugBoard('lever', 'acme'), options)
    if (outcome.status !== 'ok') throw new Error('unreachable')

    const job = outcome.postings[0]!
    // Lever never sends a company name under any key.
    expect(job.company).toBe('Acme')
    expect(job.title).toBe('Android Engineer')
    expect(job.employmentType).toBe('Permanent')
    expect(job.isRemote).toBe(true)
    expect(job.postedAt).toBe(new Date(1773857225234).toISOString())
    expect(job.snippet).toContain('Our mission')
  })

  it('treats a declared range of zero as absent, not as a job paying nothing', async () => {
    global.fetch = vi.fn(async () =>
      respond([
        {
          id: '1',
          text: 'Role',
          hostedUrl: 'https://jobs.lever.co/acme/1',
          salaryRange: { currency: 'USD', interval: 'per-year-salary', min: 0, max: 0 }
        }
      ])
    ) as typeof fetch

    const outcome = await leverAdapter.fetchBoard(slugBoard('lever', 'acme'), options)
    if (outcome.status !== 'ok') throw new Error('unreachable')
    expect(outcome.postings[0]!.salaryRange).toBeUndefined()
  })

  it("carries the employer's interval label without ever rescaling the amount", async () => {
    global.fetch = vi.fn(async () =>
      respond([
        {
          id: '1',
          text: 'Role',
          hostedUrl: 'https://jobs.lever.co/acme/1',
          // A real posting carried this label on what is plainly an hourly rate.
          salaryRange: { currency: 'USD', interval: 'bi-week-salary', min: 22.4, max: 26 }
        }
      ])
    ) as typeof fetch

    const outcome = await leverAdapter.fetchBoard(slugBoard('lever', 'acme'), options)
    if (outcome.status !== 'ok') throw new Error('unreachable')
    expect(outcome.postings[0]!.salaryRange).toBe('$22 – $26 (bi-week-salary)')
  })

  it('rejects a response that is not an array', async () => {
    global.fetch = vi.fn(async () => respond({ postings: [] })) as typeof fetch
    expect((await leverAdapter.fetchBoard(slugBoard('lever', 'acme'), options)).status).toBe('error')
  })
})

describe('ashbyAdapter.fetchBoard', () => {
  it('maps the board, including secondary locations and the rendered pay summary', async () => {
    const fetchSpy = vi.fn<FetchLike>(async () =>
      respond({
        jobs: [
          {
            id: '34413f8d-26bf-4bbc-8ade-eb309a0e2245',
            title: 'Security Engineer, Cloud',
            department: 'Engineering',
            team: 'Backend',
            employmentType: 'FullTime',
            location: 'New York, NY (HQ)',
            secondaryLocations: [{ location: 'Remote (US)' }, { notALocation: true }],
            publishedAt: '2026-04-07T17:12:35.753+00:00',
            isListed: true,
            isRemote: true,
            jobUrl: 'https://jobs.ashbyhq.com/acme/34413f8d-26bf-4bbc-8ade-eb309a0e2245',
            descriptionPlain: 'About Acme. We build things.',
            compensation: { scrapeableCompensationSalarySummary: '$211.4K - $290.6K' }
          }
        ],
        apiVersion: '1'
      })
    )
    global.fetch = fetchSpy as unknown as typeof fetch

    const outcome = await ashbyAdapter.fetchBoard(slugBoard('ashby', 'acme'), options)
    expect(fetchSpy.mock.calls[0]![0]).toContain('includeCompensation=true')
    if (outcome.status !== 'ok') throw new Error('unreachable')

    const job = outcome.postings[0]!
    expect(job.company).toBe('Acme')
    expect(job.location).toBe('New York, NY (HQ), Remote (US)')
    expect(job.salaryRange).toBe('$211.4K - $290.6K')
    expect(job.postedAt).toBe('2026-04-07T17:12:35.753Z')
  })

  it('drops a posting the company has unlisted without counting it as malformed', async () => {
    global.fetch = vi.fn(async () =>
      respond({
        jobs: [
          { id: '1', title: 'Hidden', isListed: false, jobUrl: 'https://jobs.ashbyhq.com/acme/1' },
          { id: '2', title: 'Shown', jobUrl: 'https://jobs.ashbyhq.com/acme/2' }
        ]
      })
    ) as typeof fetch

    const outcome = await ashbyAdapter.fetchBoard(slugBoard('ashby', 'acme'), options)
    if (outcome.status !== 'ok') throw new Error('unreachable')
    expect(outcome.postings.map((p) => p.id)).toEqual(['2'])
    expect(outcome.skipped).toBe(0)
  })

  it('skips a posting with no usable URL rather than inventing one', async () => {
    global.fetch = vi.fn(async () => respond({ jobs: [{ id: '1', title: 'Role', jobUrl: 'javascript:alert(1)' }] })) as typeof fetch
    const outcome = await ashbyAdapter.fetchBoard(slugBoard('ashby', 'acme'), options)
    if (outcome.status !== 'ok') throw new Error('unreachable')
    expect(outcome.postings).toHaveLength(0)
    expect(outcome.skipped).toBe(1)
  })

  it('reports an empty board as an empty board, since only a 404 proves a wrong slug', async () => {
    global.fetch = vi.fn(async () => respond({ jobs: [] })) as typeof fetch
    expect(await ashbyAdapter.fetchBoard(slugBoard('ashby', 'quiet'), options)).toEqual({
      status: 'ok',
      postings: [],
      skipped: 0
    })
  })
})

describe('workdayAdapter.fetchBoard', () => {
  const board: AtsBoardDescriptor = {
    provider: 'workday',
    token: 'acme',
    host: 'acme.wd5.myworkdayjobs.com',
    site: 'AcmeCareers'
  }

  function page(count: number, offset = 0): Response {
    return respond({
      total: 100,
      jobPostings: Array.from({ length: count }, (_, i) => ({
        title: `Engineer ${offset + i}`,
        externalPath: `/job/US-CA/Engineer_JR${offset + i}`,
        locationsText: 'US, CA, Santa Clara',
        postedOn: 'Posted 13 Days Ago',
        bulletFields: [`JR${offset + i}`]
      }))
    })
  }

  it('POSTs the query and pages at 20, which is the endpoint\'s hard cap', async () => {
    const fetchSpy = vi.fn<FetchLike>(async () => page(20))
    global.fetch = fetchSpy as unknown as typeof fetch

    const outcome = await workdayAdapter.fetchBoard(board, { ...options, limit: 40 })

    expect(fetchSpy.mock.calls[0]![0]).toBe('https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/AcmeCareers/jobs')
    const firstBody = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string)
    // Asking for more than 20 comes back with neither total nor rows, so the
    // page size is fixed and pagination does the rest.
    expect(firstBody).toEqual({ limit: 20, offset: 0, searchText: 'engineer' })
    expect(JSON.parse(fetchSpy.mock.calls[1]![1]!.body as string).offset).toBe(20)

    if (outcome.status !== 'ok') throw new Error('unreachable')
    expect(outcome.postings).toHaveLength(40)
  })

  it('stops early on a short page instead of asking for more', async () => {
    const fetchSpy = vi.fn<FetchLike>(async () => page(3))
    global.fetch = fetchSpy as unknown as typeof fetch

    const outcome = await workdayAdapter.fetchBoard(board, { ...options, limit: 40 })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    if (outcome.status !== 'ok') throw new Error('unreachable')
    expect(outcome.postings).toHaveLength(3)
  })

  it('builds a browsable posting URL from the site-relative path', async () => {
    global.fetch = vi.fn(async () => page(1)) as typeof fetch
    const outcome = await workdayAdapter.fetchBoard(board, options)
    if (outcome.status !== 'ok') throw new Error('unreachable')
    expect(outcome.postings[0]!.url).toBe(
      'https://acme.wd5.myworkdayjobs.com/AcmeCareers/job/US-CA/Engineer_JR0'
    )
    // "Posted 13 Days Ago" is a phrase, not a date — it must not become a timestamp.
    expect(outcome.postings[0]!.postedAt).toBeUndefined()
    expect(outcome.postings[0]!.snippet).toBe('Posted 13 Days Ago')
  })

  it('treats 404 (unknown site) and 422 (unknown tenant) alike as not_found', async () => {
    global.fetch = vi.fn(async () => respond('', 404)) as typeof fetch
    expect(await workdayAdapter.fetchBoard(board, options)).toEqual({ status: 'not_found' })

    global.fetch = vi.fn(async () => respond({ errorCode: 'HTTP_422' }, 422)) as typeof fetch
    expect(await workdayAdapter.fetchBoard(board, options)).toEqual({ status: 'not_found' })
  })

  it('keeps the pages it already has when a later one fails', async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(page(20)).mockResolvedValueOnce(respond('', 500))
    global.fetch = fetchSpy as typeof fetch

    const outcome = await workdayAdapter.fetchBoard(board, { ...options, limit: 40 })
    if (outcome.status !== 'ok') throw new Error('unreachable')
    expect(outcome.postings).toHaveLength(20)
  })

  it('fails clearly when the board is missing its host or site', async () => {
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as typeof fetch
    const outcome = await workdayAdapter.fetchBoard({ ...board, site: null }, options)
    expect(outcome.status).toBe('error')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('Lever regions', () => {
  it('fetches an EU board from the EU API, not the US one', async () => {
    const fetchSpy = vi.fn<FetchLike>(async () => respond([]))
    global.fetch = fetchSpy as unknown as typeof fetch

    await leverAdapter.fetchBoard({ provider: 'lever', token: 'acme', host: 'api.eu.lever.co', site: null }, options)

    // An EU customer's board answers 404 on the US host, so the region is
    // part of addressing it rather than a preference.
    expect(fetchSpy.mock.calls[0]![0]).toBe('https://api.eu.lever.co/v0/postings/acme?mode=json')
  })

  it('still fetches a board with no region from the US API', async () => {
    const fetchSpy = vi.fn<FetchLike>(async () => respond([]))
    global.fetch = fetchSpy as unknown as typeof fetch

    await leverAdapter.fetchBoard(slugBoard('lever', 'acme'), options)

    expect(fetchSpy.mock.calls[0]![0]).toBe('https://api.lever.co/v0/postings/acme?mode=json')
  })

  it('reads the region and the real token out of an EU board URL', () => {
    expect(parseAnyBoardUrl('https://jobs.eu.lever.co/acme')).toEqual({
      provider: 'lever',
      token: 'acme',
      host: 'api.eu.lever.co',
      site: null
    })
    expect(parseAnyBoardUrl('https://api.eu.lever.co/v0/postings/acme?mode=json')).toEqual({
      provider: 'lever',
      token: 'acme',
      host: 'api.eu.lever.co',
      site: null
    })
  })

  it('rebuilds a posting URL on the board\'s own region when the payload omits one', async () => {
    global.fetch = vi.fn(async () => respond([{ id: 'abc', text: 'Role' }])) as typeof fetch

    const outcome = await leverAdapter.fetchBoard(
      { provider: 'lever', token: 'acme', host: 'api.eu.lever.co', site: null },
      options
    )
    if (outcome.status !== 'ok') throw new Error('unreachable')
    expect(outcome.postings[0]!.url).toBe('https://jobs.eu.lever.co/acme/abc')
  })
})

describe('Workday board size', () => {
  function page(count: number, total: number): Response {
    return respond({
      total,
      jobPostings: Array.from({ length: count }, (_, i) => ({
        title: `Role ${i}`,
        externalPath: `/job/Remote/Role-${i}_JR${i}`
      }))
    })
  }

  const workdayBoard: AtsBoardDescriptor = {
    provider: 'workday',
    token: 'acme',
    host: 'acme.wd5.myworkdayjobs.com',
    site: 'AcmeCareers'
  }

  it("reports the board's real size, not the page it returned", async () => {
    // Workday pages 20 at a time, so a board of 300 roles answers a
    // one-page fetch with 20 — which must not be filed as its open-role count.
    global.fetch = vi.fn(async () => page(20, 300)) as typeof fetch

    const outcome = await workdayAdapter.fetchBoard(workdayBoard, { ...options, limit: 20 })
    if (outcome.status !== 'ok') throw new Error('unreachable')

    expect(outcome.postings).toHaveLength(20)
    expect(outcome.total).toBe(300)
  })

  it('ignores a total that is not a sane count, leaving the rows as the answer', async () => {
    global.fetch = vi.fn(async () =>
      respond({ total: 'lots', jobPostings: [{ title: 'Role', externalPath: '/job/Remote/Role_JR1' }] })
    ) as typeof fetch

    const outcome = await workdayAdapter.fetchBoard(workdayBoard, { ...options, limit: 20 })
    if (outcome.status !== 'ok') throw new Error('unreachable')
    expect(outcome.total).toBeUndefined()
  })

  it('refuses to fetch a board whose stored host is not a Workday one', async () => {
    const fetchSpy = vi.fn<FetchLike>(async () => respond({ total: 0, jobPostings: [] }))
    global.fetch = fetchSpy as unknown as typeof fetch

    // Defence in depth: the import schema rejects such a row, and this makes
    // one that got stored anyway inert rather than an outbound request.
    const outcome = await workdayAdapter.fetchBoard({ ...workdayBoard, host: 'evil.example.com' }, options)

    expect(outcome.status).toBe('error')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('parseAnyBoardUrl', () => {
  it.each([
    ['https://boards.greenhouse.io/acme/jobs/123', { provider: 'greenhouse', token: 'acme' }],
    ['https://job-boards.greenhouse.io/acme', { provider: 'greenhouse', token: 'acme' }],
    ['https://boards-api.greenhouse.io/v1/boards/acme/jobs', { provider: 'greenhouse', token: 'acme' }],
    ['https://jobs.lever.co/acme', { provider: 'lever', token: 'acme' }],
    ['https://jobs.lever.co/acme/abc-123', { provider: 'lever', token: 'acme' }],
    ['https://api.lever.co/v0/postings/acme', { provider: 'lever', token: 'acme' }],
    ['https://jobs.ashbyhq.com/acme/abc-123', { provider: 'ashby', token: 'acme' }],
    ['https://api.ashbyhq.com/posting-api/job-board/acme', { provider: 'ashby', token: 'acme' }]
  ])('parses %s', (url, expected) => {
    expect(parseAnyBoardUrl(url)).toMatchObject(expected)
  })

  it('parses both Workday URL shapes, including a locale prefix', () => {
    expect(parseAnyBoardUrl('https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/AcmeCareers/jobs')).toEqual({
      provider: 'workday',
      token: 'acme',
      host: 'acme.wd5.myworkdayjobs.com',
      site: 'AcmeCareers'
    })
    expect(
      parseAnyBoardUrl('https://acme.wd5.myworkdayjobs.com/en-US/AcmeCareers/job/US-CA/Engineer_JR1')
    ).toEqual({
      provider: 'workday',
      token: 'acme',
      host: 'acme.wd5.myworkdayjobs.com',
      site: 'AcmeCareers'
    })
  })

  it('refuses a Workday host with no tenant label, which carries no tenant', () => {
    expect(parseAnyBoardUrl('https://wd5.myworkdayjobs.com/AcmeCareers')).toBeNull()
  })

  it('returns null for a careers page, a lookalike host, or a non-URL', () => {
    expect(parseAnyBoardUrl('https://acme.com/careers')).toBeNull()
    expect(parseAnyBoardUrl('https://boards.greenhouse.io.evil.com/acme')).toBeNull()
    expect(parseAnyBoardUrl('Acme Labs')).toBeNull()
    expect(parseAnyBoardUrl('javascript:alert(1)')).toBeNull()
  })
})

describe('boardKeyOf', () => {
  it('is case-insensitive, so one board added twice is one row', () => {
    expect(boardKeyOf(slugBoard('greenhouse', 'Acme'))).toBe(boardKeyOf(slugBoard('greenhouse', 'acme')))
  })

  it('separates providers sharing a slug', () => {
    expect(boardKeyOf(slugBoard('lever', 'acme'))).not.toBe(boardKeyOf(slugBoard('ashby', 'acme')))
  })

  it('folds host and site into a Workday key, since a tenant alone is not a board', () => {
    const base = { provider: 'workday' as const, token: 'acme', host: 'acme.wd5.myworkdayjobs.com' }
    expect(boardKeyOf({ ...base, site: 'External' })).not.toBe(boardKeyOf({ ...base, site: 'Internal' }))
  })

  it('keeps a Workday career-site id case-sensitive, because Workday does', () => {
    // Two genuinely different sites on one tenant. Folding their case
    // together would report the second as already tracked and leave every
    // search pointed at the first.
    const base = { provider: 'workday' as const, token: 'acme', host: 'acme.wd5.myworkdayjobs.com' }
    expect(boardKeyOf({ ...base, site: 'Careers' })).not.toBe(boardKeyOf({ ...base, site: 'careers' }))
    // The host is still folded — DNS is case-insensitive.
    expect(boardKeyOf({ ...base, host: 'ACME.wd5.myworkdayjobs.com', site: 'Careers' })).toBe(
      boardKeyOf({ ...base, site: 'Careers' })
    )
  })

  it('separates Lever regions, which are different boards that can share a slug', () => {
    const us = { provider: 'lever' as const, token: 'acme', host: null, site: null }
    const eu = { ...us, host: 'api.eu.lever.co' }
    expect(boardKeyOf(eu)).not.toBe(boardKeyOf(us))
  })

  it('leaves a US Lever board keyed as it always was, so tracked boards keep their identity', () => {
    expect(boardKeyOf({ provider: 'lever', token: 'acme', host: null, site: null })).toBe('lever:acme')
  })
})

describe('isValidBoardDescriptor', () => {
  it('accepts the descriptors this app builds itself', () => {
    expect(isValidBoardDescriptor(slugBoard('greenhouse', 'acme'))).toBe(true)
    expect(isValidBoardDescriptor(slugBoard('lever', 'acme'))).toBe(true)
    expect(isValidBoardDescriptor({ provider: 'lever', token: 'acme', host: 'api.eu.lever.co', site: null })).toBe(true)
    expect(
      isValidBoardDescriptor({
        provider: 'workday',
        token: 'acme',
        host: 'acme.wd5.myworkdayjobs.com',
        site: 'AcmeCareers'
      })
    ).toBe(true)
  })

  it('refuses a Workday host that is not one, which is what an import must never store', () => {
    // The host becomes the authority of an outbound POST, so a bundle naming
    // any other host is the one field worth being strict about.
    const base = { provider: 'workday' as const, token: 'acme', site: 'Careers' }
    expect(isValidBoardDescriptor({ ...base, host: 'evil.example.com' })).toBe(false)
    expect(isValidBoardDescriptor({ ...base, host: 'myworkdayjobs.com.evil.example' })).toBe(false)
    expect(isValidBoardDescriptor({ ...base, host: 'acme.wd5.myworkdayjobs.com:8443' })).toBe(false)
    expect(isValidBoardDescriptor({ ...base, host: 'user@acme.wd5.myworkdayjobs.com' })).toBe(false)
    expect(isValidBoardDescriptor({ ...base, host: null })).toBe(false)
  })

  it('refuses a Workday board with no career site, which cannot be addressed', () => {
    expect(
      isValidBoardDescriptor({ provider: 'workday', token: 'acme', host: 'acme.wd5.myworkdayjobs.com', site: null })
    ).toBe(false)
  })

  it('refuses a Lever host that is not one of the two real regions', () => {
    expect(isValidBoardDescriptor({ provider: 'lever', token: 'acme', host: 'evil.example.com', site: null })).toBe(
      false
    )
  })

  it('refuses host or site on a provider that has neither', () => {
    expect(
      isValidBoardDescriptor({ provider: 'greenhouse', token: 'acme', host: 'evil.example.com', site: null })
    ).toBe(false)
    expect(isValidBoardDescriptor({ provider: 'ashby', token: 'acme', host: null, site: 'Careers' })).toBe(false)
  })

  it('refuses a token that is not a slug', () => {
    expect(isValidBoardDescriptor(slugBoard('greenhouse', 'acme/../other'))).toBe(false)
    expect(isValidBoardDescriptor(slugBoard('greenhouse', 'Acme Labs'))).toBe(false)
    expect(isValidBoardDescriptor(slugBoard('greenhouse', ''))).toBe(false)
  })
})

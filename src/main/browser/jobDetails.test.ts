import { describe, it, expect, vi, afterEach } from 'vitest'

// workday/linkedin/indeed/generic all drive a real headless browser
// (Playwright page.evaluate against live DOM), which is out of scope for a
// unit test — mocked at the module boundary here purely to verify
// fetchJobDetails routes to the right one, not to re-test their internals
// (those are exercised end-to-end by `npm run smoke:mcp`).
vi.mock('./scrapers/workday', () => ({ fetchWorkdayJobDetails: vi.fn(async () => ({ status: 'ok', details: { source: 'workday' } })) }))
vi.mock('./scrapers/linkedin', () => ({ fetchLinkedInJobDetails: vi.fn(async () => ({ status: 'ok', details: { source: 'linkedin' } })) }))
vi.mock('./scrapers/indeed', () => ({ fetchIndeedJobDetails: vi.fn(async () => ({ status: 'ok', details: { source: 'indeed' } })) }))
vi.mock('./scrapers/generic', () => ({ fetchGenericJobDetails: vi.fn(async () => ({ status: 'ok', details: { source: 'generic' } })) }))

import { fetchJobDetails } from './jobDetails'
import { fetchWorkdayJobDetails } from './scrapers/workday'
import { fetchLinkedInJobDetails } from './scrapers/linkedin'
import { fetchIndeedJobDetails } from './scrapers/indeed'
import { fetchGenericJobDetails } from './scrapers/generic'

const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
})

describe('fetchJobDetails routing', () => {
  it('routes a Greenhouse URL to the real Greenhouse API scraper', async () => {
    global.fetch = vi.fn(async () => new Response('', { status: 404 })) as typeof fetch
    const result = await fetchJobDetails('https://boards.greenhouse.io/acme/jobs/123')
    // Confirms the *real* greenhouse scraper ran (its distinctive 404 message), not a stub.
    expect(result).toEqual({ status: 'not_found', message: expect.stringContaining('Greenhouse') })
  })

  it('routes a Lever URL to the real Lever API scraper', async () => {
    global.fetch = vi.fn(async () => new Response('', { status: 404 })) as typeof fetch
    const result = await fetchJobDetails('https://jobs.lever.co/acme/11111111-2222-3333-4444-555555555555')
    expect(result).toEqual({ status: 'not_found', message: expect.stringContaining('Lever') })
  })

  it('routes an Ashby URL to the real Ashby API scraper', async () => {
    global.fetch = vi.fn(async () => new Response('', { status: 500 })) as typeof fetch
    const result = await fetchJobDetails('https://jobs.ashbyhq.com/acme/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(result).toEqual({ status: 'not_found', message: expect.stringContaining('Ashby') })
  })

  it('routes a Workday URL to the workday scraper', async () => {
    await fetchJobDetails('https://acme.myworkdayjobs.com/careers/job/1')
    expect(fetchWorkdayJobDetails).toHaveBeenCalledWith('https://acme.myworkdayjobs.com/careers/job/1')
  })

  it('routes a LinkedIn URL to the linkedin scraper', async () => {
    await fetchJobDetails('https://www.linkedin.com/jobs/view/1')
    expect(fetchLinkedInJobDetails).toHaveBeenCalledWith('https://www.linkedin.com/jobs/view/1')
  })

  it('routes an Indeed URL to the indeed scraper', async () => {
    await fetchJobDetails('https://www.indeed.com/viewjob?jk=1')
    expect(fetchIndeedJobDetails).toHaveBeenCalledWith('https://www.indeed.com/viewjob?jk=1')
  })

  it('routes anything unrecognized to the generic scraper', async () => {
    await fetchJobDetails('https://careers.example.com/job/1')
    expect(fetchGenericJobDetails).toHaveBeenCalledWith('https://careers.example.com/job/1')
  })
})

import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchLeverJobDetails } from './lever'

const originalFetch = global.fetch
const uuid = '11111111-2222-3333-4444-555555555555'

afterEach(() => {
  global.fetch = originalFetch
})

describe('fetchLeverJobDetails', () => {
  it('returns not_found for a non-Lever URL', async () => {
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy
    const result = await fetchLeverJobDetails('https://jobs.lever.co/acme/not-a-uuid')
    expect(result.status).toBe('not_found')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fetches the public postings API and maps a successful response, including list sections', async () => {
    global.fetch = vi.fn(async (url: string) => {
      expect(url).toBe(`https://api.lever.co/v0/postings/acme/${uuid}?mode=json`)
      return new Response(
        JSON.stringify({
          id: uuid,
          text: 'Senior Engineer',
          hostedUrl: `https://jobs.lever.co/acme/${uuid}`,
          applyUrl: `https://jobs.lever.co/acme/${uuid}/apply`,
          categories: { location: 'Remote' },
          description: '<p>About the role</p>',
          lists: [{ text: 'Requirements', content: '<ul><li>5 years experience</li></ul>' }]
        }),
        { status: 200 }
      )
    }) as typeof fetch

    const result = await fetchLeverJobDetails(`https://jobs.lever.co/acme/${uuid}`)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') throw new Error('unreachable')
    expect(result.details.title).toBe('Senior Engineer')
    expect(result.details.company).toBe('acme')
    expect(result.details.location).toBe('Remote')
    expect(result.details.applicationUrl).toBe(`https://jobs.lever.co/acme/${uuid}/apply`)
    expect(result.details.detectedAts).toBe('lever')
    expect(result.details.applyMethod).toBe('external_form')
    expect(result.details.description).toContain('About the role')
    expect(result.details.description).toContain('<h3>Requirements</h3>')
    expect(result.details.description).toContain('5 years experience')
  })

  it('falls back to hostedUrl as applicationUrl when applyUrl is absent', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: uuid,
            text: 'Role',
            hostedUrl: `https://jobs.lever.co/acme/${uuid}`,
            categories: {}
          }),
          { status: 200 }
        )
    ) as typeof fetch

    const result = await fetchLeverJobDetails(`https://jobs.lever.co/acme/${uuid}`)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') throw new Error('unreachable')
    expect(result.details.applicationUrl).toBe(`https://jobs.lever.co/acme/${uuid}`)
    expect(result.details.location).toBeUndefined()
  })

  it('returns a closed-posting message for a 404', async () => {
    global.fetch = vi.fn(async () => new Response('', { status: 404 })) as typeof fetch
    const result = await fetchLeverJobDetails(`https://jobs.lever.co/acme/${uuid}`)
    expect(result.status).toBe('not_found')
    if (result.status !== 'not_found') throw new Error('unreachable')
    expect(result.message).toContain('closed')
  })

  it('returns not_found for other non-ok statuses', async () => {
    global.fetch = vi.fn(async () => new Response('', { status: 503 })) as typeof fetch
    const result = await fetchLeverJobDetails(`https://jobs.lever.co/acme/${uuid}`)
    expect(result).toEqual({ status: 'not_found', message: expect.stringContaining('503') })
  })

  it('returns not_found rather than throwing on a network error', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('timeout')
    }) as typeof fetch
    const result = await fetchLeverJobDetails(`https://jobs.lever.co/acme/${uuid}`)
    expect(result.status).toBe('not_found')
  })
})

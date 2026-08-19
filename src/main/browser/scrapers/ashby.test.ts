import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchAshbyJobDetails } from './ashby'

const originalFetch = global.fetch
const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

afterEach(() => {
  global.fetch = originalFetch
})

describe('fetchAshbyJobDetails', () => {
  it('returns not_found for a non-Ashby URL', async () => {
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy
    const result = await fetchAshbyJobDetails('https://jobs.ashbyhq.com/acme')
    expect(result.status).toBe('not_found')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fetches the board, finds the matching posting by id, and maps it', async () => {
    global.fetch = vi.fn(async (url: string) => {
      expect(url).toBe('https://api.ashbyhq.com/posting-api/job-board/acme')
      return new Response(
        JSON.stringify({
          jobs: [
            { id: 'other-id', title: 'Wrong Job', jobUrl: 'x', applyUrl: 'x' },
            {
              id: uuid,
              title: 'Product Designer',
              location: 'NYC',
              jobUrl: `https://jobs.ashbyhq.com/acme/${uuid}`,
              applyUrl: `https://jobs.ashbyhq.com/acme/${uuid}/apply`,
              descriptionHtml: '<p>Design things</p>'
            }
          ]
        }),
        { status: 200 }
      )
    }) as typeof fetch

    const result = await fetchAshbyJobDetails(`https://jobs.ashbyhq.com/acme/${uuid}`)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') throw new Error('unreachable')
    expect(result.details.title).toBe('Product Designer')
    expect(result.details.company).toBe('acme')
    expect(result.details.location).toBe('NYC')
    expect(result.details.applicationUrl).toBe(`https://jobs.ashbyhq.com/acme/${uuid}/apply`)
    expect(result.details.detectedAts).toBe('ashby')
    expect(result.details.description).toContain('Design things')
  })

  it('returns not_found when the posting is not on the current board (closed)', async () => {
    global.fetch = vi.fn(
      async () => new Response(JSON.stringify({ jobs: [] }), { status: 200 })
    ) as typeof fetch

    const result = await fetchAshbyJobDetails(`https://jobs.ashbyhq.com/acme/${uuid}`)
    expect(result.status).toBe('not_found')
    if (result.status !== 'not_found') throw new Error('unreachable')
    expect(result.message).toContain('no longer listed')
  })

  it('returns not_found for a non-ok board response', async () => {
    global.fetch = vi.fn(async () => new Response('', { status: 500 })) as typeof fetch
    const result = await fetchAshbyJobDetails(`https://jobs.ashbyhq.com/acme/${uuid}`)
    expect(result).toEqual({ status: 'not_found', message: expect.stringContaining('500') })
  })

  it('falls back to jobUrl as applicationUrl when applyUrl is absent', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            jobs: [{ id: uuid, title: 'Role', jobUrl: `https://jobs.ashbyhq.com/acme/${uuid}` }]
          }),
          { status: 200 }
        )
    ) as typeof fetch

    const result = await fetchAshbyJobDetails(`https://jobs.ashbyhq.com/acme/${uuid}`)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') throw new Error('unreachable')
    expect(result.details.applicationUrl).toBe(`https://jobs.ashbyhq.com/acme/${uuid}`)
  })
})

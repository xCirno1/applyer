import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchGreenhouseJobDetails } from './greenhouse'

const originalFetch = global.fetch

afterEach(() => {
  global.fetch = originalFetch
})

describe('fetchGreenhouseJobDetails', () => {
  it('returns not_found for a URL that does not look like a Greenhouse posting', async () => {
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy
    const result = await fetchGreenhouseJobDetails('https://boards.greenhouse.io/acme/about')
    expect(result).toEqual({ status: 'not_found', message: expect.stringContaining('does not look like') })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fetches the public API and maps a successful response', async () => {
    global.fetch = vi.fn(async (url: string) => {
      expect(url).toBe('https://boards-api.greenhouse.io/v1/boards/acme/jobs/123?content=true')
      return new Response(
        JSON.stringify({
          id: 123,
          title: 'Backend Engineer',
          content: '<p>Build things &amp; ship them.</p>',
          absolute_url: 'https://boards.greenhouse.io/acme/jobs/123',
          location: { name: 'Remote' },
          company_name: 'Acme Inc'
        }),
        { status: 200 }
      )
    }) as typeof fetch

    const result = await fetchGreenhouseJobDetails('https://boards.greenhouse.io/acme/jobs/123')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') throw new Error('unreachable')
    expect(result.details.title).toBe('Backend Engineer')
    expect(result.details.company).toBe('Acme Inc')
    expect(result.details.location).toBe('Remote')
    expect(result.details.applicationUrl).toBe('https://boards.greenhouse.io/acme/jobs/123')
    expect(result.details.detectedAts).toBe('greenhouse')
    expect(result.details.applyMethod).toBe('external_form')
    expect(result.details.requiresLogin).toBe(false)
    // The sanitized HTML keeps the "&" escaped, since that field is rendered
    // as markup. The plain-text field is read by the agent, not a browser,
    // so it gets the real character.
    expect(result.details.description).toContain('Build things &amp; ship them.')
    expect(result.details.descriptionText).toContain('Build things & ship them.')
  })

  it('falls back to the URL token as company name when company_name is absent', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ id: 1, title: 'Role', absolute_url: 'https://boards.greenhouse.io/acme/jobs/1' }),
          { status: 200 }
        )
    ) as typeof fetch

    const result = await fetchGreenhouseJobDetails('https://boards.greenhouse.io/acme/jobs/1')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') throw new Error('unreachable')
    expect(result.details.company).toBe('acme')
    expect(result.details.description).toBe('')
    expect(result.details.descriptionText).toBe('')
  })

  it('returns not_found for a 404', async () => {
    global.fetch = vi.fn(async () => new Response('', { status: 404 })) as typeof fetch
    const result = await fetchGreenhouseJobDetails('https://boards.greenhouse.io/acme/jobs/999')
    expect(result).toEqual({ status: 'not_found', message: expect.stringContaining('404') })
  })

  it('returns not_found for a non-2xx, non-404 response', async () => {
    global.fetch = vi.fn(async () => new Response('', { status: 500 })) as typeof fetch
    const result = await fetchGreenhouseJobDetails('https://boards.greenhouse.io/acme/jobs/999')
    expect(result).toEqual({ status: 'not_found', message: expect.stringContaining('500') })
  })

  it('returns not_found rather than throwing when the network request itself fails', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('DNS resolution failed')
    }) as typeof fetch
    const result = await fetchGreenhouseJobDetails('https://boards.greenhouse.io/acme/jobs/1')
    expect(result.status).toBe('not_found')
    if (result.status !== 'not_found') throw new Error('unreachable')
    expect(result.message).toContain('DNS resolution failed')
  })

  it('sanitizes malicious content in the job description', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 1,
            title: 'Role',
            content: '<script>alert(1)</script><p>legit</p>',
            absolute_url: 'https://boards.greenhouse.io/acme/jobs/1'
          }),
          { status: 200 }
        )
    ) as typeof fetch

    const result = await fetchGreenhouseJobDetails('https://boards.greenhouse.io/acme/jobs/1')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') throw new Error('unreachable')
    expect(result.details.description).not.toContain('<script>')
    expect(result.details.description).toContain('legit')
  })
})

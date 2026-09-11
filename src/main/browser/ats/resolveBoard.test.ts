import { describe, it, expect, vi, afterEach } from 'vitest'

const logInfo = vi.fn()
vi.mock('../../logger', () => ({ appLogger: { info: (...args: unknown[]) => logInfo(...args), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { resolveCompanyBoard } from './resolveBoard'

const originalFetch = global.fetch

afterEach(() => {
  global.fetch = originalFetch
  logInfo.mockClear()
})

/**
 * Routes a fake response per (provider, slug), so a test can describe a
 * company's real-world footprint — live on one ATS, dead on another, absent
 * from the third — rather than mocking one call at a time.
 */
function routeFetch(
  handler: (provider: 'greenhouse' | 'lever' | 'ashby', token: string) => Response
): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async (input: string) => {
    const url = new URL(input)
    if (url.hostname === 'boards-api.greenhouse.io') {
      return handler('greenhouse', url.pathname.split('/')[3]!)
    }
    if (url.hostname === 'api.lever.co') {
      return handler('lever', url.pathname.split('/')[3]!)
    }
    if (url.hostname === 'api.ashbyhq.com') {
      return handler('ashby', url.pathname.split('/')[3]!)
    }
    return new Response('', { status: 404 })
  })
  global.fetch = spy as unknown as typeof fetch
  return spy
}

const notFound = (): Response => new Response('', { status: 404 })
const greenhouseJobs = (n: number): Response =>
  new Response(
    JSON.stringify({
      jobs: Array.from({ length: n }, (_, i) => ({ id: i, title: 'Role', absolute_url: `https://x/${i}` }))
    }),
    { status: 200 }
  )
const leverJobs = (n: number): Response =>
  new Response(
    JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: String(i), text: 'Role', hostedUrl: `https://x/${i}` }))),
    { status: 200 }
  )
const ashbyJobs = (n: number): Response =>
  new Response(
    JSON.stringify({
      jobs: Array.from({ length: n }, (_, i) => ({
        id: String(i),
        title: 'Role',
        jobUrl: `https://jobs.ashbyhq.com/acme/${i}`
      }))
    }),
    { status: 200 }
  )

describe('resolveCompanyBoard — probing a bare company name', () => {
  it('ranks by open roles, not by which provider answers first', async () => {
    // The migration case: the old Lever board is still live and empty while
    // every role is on Ashby. Keeping the first 200 would report the company
    // as hiring nobody.
    routeFetch((provider) => {
      if (provider === 'lever') return leverJobs(0)
      if (provider === 'ashby') return ashbyJobs(11)
      return notFound()
    })

    const outcome = await resolveCompanyBoard({ query: 'duffel' })
    expect(outcome.status).toBe('resolved')
    if (outcome.status !== 'resolved') throw new Error('unreachable')
    expect(outcome.descriptor.provider).toBe('ashby')
    expect(outcome.jobCount).toBe(11)
    expect(outcome.candidates.map((c) => c.provider)).toEqual(['ashby', 'lever'])
  })

  it('flags a company that is live on two systems at once instead of hiding one', async () => {
    routeFetch((provider) => {
      if (provider === 'lever') return leverJobs(3)
      if (provider === 'ashby') return ashbyJobs(11)
      return notFound()
    })

    const outcome = await resolveCompanyBoard({ query: 'acme' })
    if (outcome.status !== 'resolved') throw new Error('unreachable')
    expect(outcome.ambiguous).toBe(true)
    expect(outcome.descriptor.provider).toBe('ashby')
  })

  it('does not call one provider answering on two slug guesses a migration', async () => {
    // "Acme Labs" generates several slugs; two of them landing on the same
    // Lever board is one system answering twice, not a company mid-move.
    routeFetch((provider) => (provider === 'lever' ? leverJobs(4) : notFound()))

    const outcome = await resolveCompanyBoard({ query: 'Acme Labs' })
    if (outcome.status !== 'resolved') throw new Error('unreachable')
    expect(outcome.candidates.length).toBeGreaterThan(1)
    expect(outcome.ambiguous).toBe(false)
  })

  it('keeps a board that answers with no roles, since only a 404 proves a wrong slug', async () => {
    routeFetch((provider) => (provider === 'ashby' ? ashbyJobs(0) : notFound()))

    const outcome = await resolveCompanyBoard({ query: 'snyk' })
    if (outcome.status !== 'resolved') throw new Error('unreachable')
    expect(outcome.descriptor.provider).toBe('ashby')
    // Reported honestly as an empty board rather than promoted or discarded.
    expect(outcome.jobCount).toBe(0)
    expect(outcome.ambiguous).toBe(false)
  })

  it('prefers a known provider only among candidates that tie', async () => {
    routeFetch((provider) => {
      if (provider === 'greenhouse') return greenhouseJobs(4)
      if (provider === 'lever') return leverJobs(4)
      return notFound()
    })

    const preferred = await resolveCompanyBoard({ query: 'acme', preferProvider: 'lever' })
    if (preferred.status !== 'resolved') throw new Error('unreachable')
    expect(preferred.descriptor.provider).toBe('lever')
  })

  it('never lets a preferred provider beat a board that actually has roles', async () => {
    routeFetch((provider) => {
      if (provider === 'greenhouse') return greenhouseJobs(9)
      if (provider === 'lever') return leverJobs(0)
      return notFound()
    })

    const outcome = await resolveCompanyBoard({ query: 'acme', preferProvider: 'lever' })
    if (outcome.status !== 'resolved') throw new Error('unreachable')
    expect(outcome.descriptor.provider).toBe('greenhouse')
  })

  it('prefers the slug closest to the input when counts tie', async () => {
    routeFetch((provider, token) => {
      if (provider !== 'greenhouse') return notFound()
      return token === 'acmelabs' || token === 'acme' ? greenhouseJobs(2) : notFound()
    })

    const outcome = await resolveCompanyBoard({ query: 'Acme Labs' })
    if (outcome.status !== 'resolved') throw new Error('unreachable')
    // "acmelabs" is generated before "acme" and both answered equally.
    expect(outcome.descriptor.token).toBe('acmelabs')
  })

  it('reports not_found when every provider 404s', async () => {
    routeFetch(() => notFound())
    const outcome = await resolveCompanyBoard({ query: 'nonsense-xyz-9' })
    expect(outcome.status).toBe('not_found')
    if (outcome.status !== 'not_found') throw new Error('unreachable')
    expect(outcome.triedTokens).toContain('nonsense-xyz-9')
  })

  it('does not report not_found when one provider 404d but another never answered', async () => {
    // Only a 404 from *every* provider rules a company out. A provider that
    // failed for a network reason may well be the one holding the board, so
    // the mixture is reported as an unfinished check rather than "no such
    // company" — which would send the user hunting for a slug that is fine.
    global.fetch = vi.fn(async (input: string) => {
      if (new URL(input).hostname === 'api.ashbyhq.com') throw new Error('ECONNRESET')
      return new Response('', { status: 404 })
    }) as unknown as typeof fetch

    const outcome = await resolveCompanyBoard({ query: 'acme' })
    expect(outcome.status).toBe('error')
    if (outcome.status !== 'error') throw new Error('unreachable')
    expect(outcome.message).toContain('ECONNRESET')
  })

  it('reports an error, not "no such company", when nothing could be reached', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('ENOTFOUND')
    }) as typeof fetch

    const outcome = await resolveCompanyBoard({ query: 'acme' })
    expect(outcome.status).toBe('error')
    if (outcome.status !== 'error') throw new Error('unreachable')
    expect(outcome.message).toContain('ENOTFOUND')
  })

  it('refuses input that yields no slug at all rather than probing an empty one', async () => {
    const spy = vi.fn()
    global.fetch = spy as unknown as typeof fetch
    const outcome = await resolveCompanyBoard({ query: '!!!' })
    expect(outcome.status).toBe('error')
    expect(spy).not.toHaveBeenCalled()
  })

  it('does not probe Workday, whose boards cannot be guessed from a name', async () => {
    const spy = routeFetch(() => notFound())
    await resolveCompanyBoard({ query: 'acme' })
    const hosts = spy.mock.calls.map((call) => new URL(call[0] as string).hostname)
    expect(hosts.every((host) => !host.endsWith('myworkdayjobs.com'))).toBe(true)
  })
})

describe('resolveCompanyBoard — an explicit board', () => {
  it('takes a pasted board URL at face value and verifies it, without probing', async () => {
    const spy = routeFetch(() => leverJobs(5))
    const outcome = await resolveCompanyBoard({ query: 'https://jobs.lever.co/acme/abc' })

    expect(spy).toHaveBeenCalledTimes(1)
    if (outcome.status !== 'resolved') throw new Error('unreachable')
    expect(outcome.descriptor).toMatchObject({ provider: 'lever', token: 'acme' })
    expect(outcome.verified).toBe(true)
    expect(outcome.jobCount).toBe(5)
  })

  it('rejects a pasted URL whose slug 404s', async () => {
    routeFetch(() => notFound())
    expect((await resolveCompanyBoard({ query: 'https://jobs.lever.co/nope' })).status).toBe('not_found')
  })

  it('still tracks an explicit board that could not be reached, marked unverified', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('offline')
    }) as typeof fetch

    const outcome = await resolveCompanyBoard({ query: 'https://jobs.lever.co/acme' })
    if (outcome.status !== 'resolved') throw new Error('unreachable')
    expect(outcome.verified).toBe(false)
    expect(outcome.jobCount).toBe(0)
  })

  it('accepts an explicit provider + token and skips probing entirely', async () => {
    const spy = routeFetch(() => greenhouseJobs(2))
    const outcome = await resolveCompanyBoard({ query: 'Acme Labs', provider: 'greenhouse', token: 'acme-labs' })

    expect(spy).toHaveBeenCalledTimes(1)
    if (outcome.status !== 'resolved') throw new Error('unreachable')
    expect(outcome.descriptor.token).toBe('acme-labs')
    expect(outcome.companyName).toBe('Acme Labs')
  })

  it('explains that a Workday board cannot be addressed by a bare token', async () => {
    const spy = vi.fn()
    global.fetch = spy as unknown as typeof fetch
    const outcome = await resolveCompanyBoard({ query: 'Acme', provider: 'workday', token: 'acme' })
    expect(outcome.status).toBe('error')
    if (outcome.status !== 'error') throw new Error('unreachable')
    expect(outcome.message).toContain('URL')
    expect(spy).not.toHaveBeenCalled()
  })

  it('falls back to the resolved slug when no display name is given', async () => {
    routeFetch(() => leverJobs(1))
    const outcome = await resolveCompanyBoard({ query: 'https://jobs.lever.co/acme' })
    if (outcome.status !== 'resolved') throw new Error('unreachable')
    expect(outcome.companyName).toBe('acme')
  })

  it("reports a paging board's own total, not the handful of roles a probe asked for", async () => {
    // A probe deliberately asks for very little, so on Workday — the one
    // provider that pages — the rows that come back are the probe's limit for
    // every board bigger than it. Reporting those would greet a tenant of 412
    // open roles with "20 open roles right now", and would greet the next
    // large board with the same 20.
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            total: 412,
            jobPostings: Array.from({ length: 20 }, (_, i) => ({
              title: 'Engineer',
              externalPath: `/job/Remote/Engineer_JR${i}`
            }))
          }),
          { status: 200 }
        )
    ) as unknown as typeof fetch

    const outcome = await resolveCompanyBoard({
      query: 'https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Remote/Engineer_JR1'
    })

    if (outcome.status !== 'resolved') throw new Error('unreachable')
    expect(outcome.descriptor).toEqual({
      provider: 'workday',
      token: 'acme',
      host: 'acme.wd5.myworkdayjobs.com',
      site: 'Careers'
    })
    expect(outcome.jobCount).toBe(412)
    expect(outcome.candidates[0]?.jobCount).toBe(412)
  })
})

describe('probe-pool logging', () => {
  it('records how big the pool was, not just what it found', async () => {
    // The failure this exists to make visible: a resolution that draws from
    // one candidate instead of several still ends with a board, so the
    // outcome alone cannot distinguish a thorough run from a starved one.
    routeFetch((provider) => (provider === 'ashby' ? ashbyJobs(4) : notFound()))

    await resolveCompanyBoard({ query: 'Acme Labs' })

    const line = logInfo.mock.calls.map((call) => String(call[0])).find((text) => text.includes('Board probe'))
    expect(line).toBeDefined()
    expect(line).toContain('3 slug candidate(s) [acmelabs, acme-labs, acme]')
    expect(line).toContain('over 9 probe(s)')
    expect(line).toContain('3 answered (3 with roles)')
  })

  it('records a pool where nothing answered at all', async () => {
    routeFetch(() => notFound())

    await resolveCompanyBoard({ query: 'acme' })

    const line = logInfo.mock.calls.map((call) => String(call[0])).find((text) => text.includes('Board probe'))
    expect(line).toContain('0 answered (0 with roles)')
    expect(line).toContain('3 not found')
  })
})

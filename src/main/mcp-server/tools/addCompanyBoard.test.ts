import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../../db/testDb'
import type * as schema from '../../db/schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../../db/index', () => ({ getDb: () => testDb }))
// The renderer isn't running under test; the broadcast is a no-op either way.
vi.mock('../../ipc/jobsBroadcast', () => ({ broadcastCompanyBoardsChanged: vi.fn() }))

const originalFetch = global.fetch

beforeEach(() => {
  testDb = createTestDb().db
})

afterEach(() => {
  global.fetch = originalFetch
})

import { addCompanyBoardTool } from './addCompanyBoard'
import { listCompanyBoardsTool } from './listCompanyBoards'
import { listCompanyBoards } from '../../db/repositories/companyBoardsRepository'
import { clearBoardCache } from '../../browser/ats/boardCache'

function parse(result: { content: unknown[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text)
}

function route(handler: (provider: string, token: string) => Response): void {
  global.fetch = vi.fn(async (input: string) => {
    const url = new URL(input)
    if (url.hostname === 'boards-api.greenhouse.io') return handler('greenhouse', url.pathname.split('/')[3]!)
    if (url.hostname === 'api.lever.co') return handler('lever', url.pathname.split('/')[3]!)
    if (url.hostname === 'api.ashbyhq.com') return handler('ashby', url.pathname.split('/')[3]!)
    return new Response('', { status: 404 })
  }) as unknown as typeof fetch
}

const notFound = (): Response => new Response('', { status: 404 })
const ashbyWith = (n: number): Response =>
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
const greenhouseWith = (n: number): Response =>
  new Response(
    JSON.stringify({
      jobs: Array.from({ length: n }, (_, i) => ({
        id: i + 1,
        title: 'Role',
        absolute_url: `https://job-boards.greenhouse.io/acme/jobs/${i + 1}`
      }))
    }),
    { status: 200 }
  )
const leverWith = (n: number): Response =>
  new Response(
    JSON.stringify(
      Array.from({ length: n }, (_, i) => ({ id: String(i), text: 'Role', hostedUrl: `https://jobs.lever.co/acme/${i}` }))
    ),
    { status: 200 }
  )

beforeEach(() => {
  clearBoardCache()
})

describe('addCompanyBoardTool', () => {
  it('resolves a bare company name and tracks the board it finds', async () => {
    route((provider) => (provider === 'ashby' ? ashbyWith(11) : notFound()))

    const result = await addCompanyBoardTool({ company: 'acme', provider: undefined, token: undefined, displayName: undefined })
    const payload = parse(result)

    expect(payload.status).toBe('added')
    expect(payload.board).toMatchObject({ provider: 'ashby', token: 'acme' })
    expect(payload.openRoles).toBe(11)
    expect(listCompanyBoards({}).total).toBe(1)
  })

  it('keeps the busier board when a company answers on two systems, and says so', async () => {
    route((provider) => {
      if (provider === 'lever') return leverWith(0)
      if (provider === 'ashby') return ashbyWith(11)
      return notFound()
    })

    const payload = parse(
      await addCompanyBoardTool({ company: 'acme', provider: undefined, token: undefined, displayName: undefined })
    )
    expect(payload.board).toMatchObject({ provider: 'ashby' })
  })

  it('reports a live board with nothing open as exactly that, not as a failure', async () => {
    route((provider) => (provider === 'ashby' ? ashbyWith(0) : notFound()))

    const payload = parse(
      await addCompanyBoardTool({ company: 'snyk', provider: undefined, token: undefined, displayName: undefined })
    )
    expect(payload.openRoles).toBe(0)
    expect(String(payload.message)).toContain('no open roles')
  })

  it('is idempotent — adding the same company twice tracks one board', async () => {
    route((provider) => (provider === 'ashby' ? ashbyWith(2) : notFound()))
    const args = { company: 'acme', provider: undefined, token: undefined, displayName: undefined }

    await addCompanyBoardTool(args)
    const payload = parse(await addCompanyBoardTool(args))

    expect(payload.status).toBe('already_tracked')
    expect(listCompanyBoards({}).total).toBe(1)
  })

  it('reports not_found (with the slugs it tried) when every board 404s', async () => {
    route(() => notFound())

    const payload = parse(
      await addCompanyBoardTool({ company: 'nonsense xyz', provider: undefined, token: undefined, displayName: undefined })
    )
    expect(payload.status).toBe('not_found')
    expect(payload.triedSlugs).toContain('nonsensexyz')
    expect(listCompanyBoards({}).total).toBe(0)
  })

  it('rejects a token with no provider, since a slug alone names no API', async () => {
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as unknown as typeof fetch

    const result = await addCompanyBoardTool({ company: 'Acme', provider: undefined, token: 'acme', displayName: undefined })
    expect(result.isError).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('takes a provider with no token as a preference and still probes the rest', async () => {
    // What a web search usually establishes: the careers page points at
    // Lever, but the slug is not on it. Both boards answer with the same
    // number of roles, so the hint is what settles it.
    route((provider) => {
      if (provider === 'lever') return leverWith(3)
      if (provider === 'greenhouse') return greenhouseWith(3)
      return notFound()
    })

    const payload = parse(
      await addCompanyBoardTool({ company: 'acme', provider: 'lever', token: undefined, displayName: undefined })
    )

    expect(payload.board).toMatchObject({ provider: 'lever', token: 'acme' })
  })

  it('lets a board with more roles beat the preferred provider', async () => {
    // The migration case the ranking exists for: the hint names the ATS the
    // careers page still links, but the roles are on the other one.
    route((provider) => {
      if (provider === 'lever') return leverWith(0)
      if (provider === 'greenhouse') return greenhouseWith(9)
      return notFound()
    })

    const payload = parse(
      await addCompanyBoardTool({ company: 'acme', provider: 'lever', token: undefined, displayName: undefined })
    )

    expect(payload.board).toMatchObject({ provider: 'greenhouse' })
  })

  it('records the board as agent-added, so the UI can show where it came from', async () => {
    route((provider) => (provider === 'lever' ? leverWith(1) : notFound()))
    await addCompanyBoardTool({
      company: 'https://jobs.lever.co/acme',
      provider: undefined,
      token: undefined,
      displayName: 'Acme Labs'
    })

    const board = listCompanyBoards({}).boards[0]!
    expect(board.addedBy).toBe('agent')
    expect(board.companyName).toBe('Acme Labs')
  })
})

describe('listCompanyBoardsTool', () => {
  it('explains an empty list rather than returning a bare zero', () => {
    const payload = parse(listCompanyBoardsTool({ search: undefined, limit: undefined, offset: undefined }))
    expect(payload.total).toBe(0)
    expect(String(payload.message)).toContain('add_company_board')
  })

  it('lists tracked boards with the outcome of their last fetch', async () => {
    route((provider) => (provider === 'ashby' ? ashbyWith(3) : notFound()))
    await addCompanyBoardTool({ company: 'acme', provider: undefined, token: undefined, displayName: undefined })

    const payload = parse(listCompanyBoardsTool({ search: undefined, limit: undefined, offset: undefined }))
    expect(payload.total).toBe(1)
    expect((payload.boards as Record<string, unknown>[])[0]).toMatchObject({
      provider: 'ashby',
      token: 'acme',
      enabled: true,
      addedBy: 'agent',
      // Never fetched by a search yet — distinct from a board that returned 0.
      lastJobCount: null
    })
  })
})

import { describe, it, expect } from 'vitest'
import { validateExportBundle } from './importSchema'
import { EXPORT_SCHEMA_VERSION } from '@shared/types/dataTransfer'
import type { ExportBundle } from '@shared/types/dataTransfer'

function validBundle(): ExportBundle {
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: '2020-01-01T00:00:00.000Z',
    appVersion: '1.0.0',
    data: {
      jobs: [
        {
          id: '1',
          externalId: null,
          source: null,
          title: 'Backend Engineer',
          company: 'Acme',
          location: null,
          url: 'https://example.com/1',
          description: null,
          salaryRange: null,
          status: 'queued',
          matchScore: null,
          matchReasons: null,
          applicationUrl: null,
          applyMethod: null,
          screenshotPath: null,
          failureTag: null,
          failureMessage: null,
          blockingReason: null,
          blockingTaskId: null,
          queuedAt: '2020-01-01T00:00:00.000Z',
          filledAt: null,
          submittedAt: null,
          createdAt: '2020-01-01T00:00:00.000Z',
          updatedAt: '2020-01-01T00:00:00.000Z'
        }
      ]
    }
  }
}

describe('validateExportBundle', () => {
  it('accepts a well-formed bundle', () => {
    const result = validateExportBundle(validBundle())
    expect(result.ok).toBe(true)
  })

  it('accepts a bundle with an empty data object', () => {
    const result = validateExportBundle({ ...validBundle(), data: {} })
    expect(result.ok).toBe(true)
  })

  it('rejects non-object input', () => {
    expect(validateExportBundle(null).ok).toBe(false)
    expect(validateExportBundle('not a bundle').ok).toBe(false)
    expect(validateExportBundle(42).ok).toBe(false)
  })

  it('rejects a mismatched schemaVersion', () => {
    const result = validateExportBundle({ ...validBundle(), schemaVersion: 999 })
    expect(result.ok).toBe(false)
  })

  it('rejects a job record missing required fields', () => {
    const bundle = validBundle()
    bundle.data.jobs = [{ ...bundle.data.jobs![0]!, title: undefined } as never]
    expect(validateExportBundle(bundle).ok).toBe(false)
  })

  it('rejects a job with an invalid status enum value', () => {
    const bundle = validBundle()
    bundle.data.jobs = [{ ...bundle.data.jobs![0]!, status: 'not-a-status' } as never]
    expect(validateExportBundle(bundle).ok).toBe(false)
  })

  it('rejects an object with the required top-level keys missing', () => {
    expect(validateExportBundle({}).ok).toBe(false)
  })
})

describe('validateExportBundle — company boards', () => {
  const board = {
    provider: 'greenhouse',
    token: 'acme',
    host: null,
    site: null,
    companyName: 'Acme Labs',
    addedBy: 'user',
    enabled: true,
    createdAt: '2020-01-01T00:00:00.000Z'
  }

  function withBoards(boards: unknown[]): unknown {
    return { ...validBundle(), data: { companyBoards: boards } }
  }

  it('accepts a well-formed board', () => {
    const result = validateExportBundle(withBoards([board]))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.bundle.data.companyBoards).toHaveLength(1)
  })

  it('rejects a provider this build has no adapter for', () => {
    expect(validateExportBundle(withBoards([{ ...board, provider: 'smartrecruiters' }])).ok).toBe(false)
  })

  it('rejects a board with no token to address it by', () => {
    expect(validateExportBundle(withBoards([{ ...board, token: '' }])).ok).toBe(false)
  })

  it('rejects a Workday host that is not a Workday host', () => {
    // A bundle is a file, and this host becomes the authority of an outbound
    // POST on the next search — the one imported value that must not be
    // taken on trust.
    expect(
      validateExportBundle(
        withBoards([{ ...board, provider: 'workday', host: 'evil.example.com', site: 'Careers' }])
      ).ok
    ).toBe(false)
    expect(
      validateExportBundle(
        withBoards([{ ...board, provider: 'workday', host: 'myworkdayjobs.com.evil.example', site: 'Careers' }])
      ).ok
    ).toBe(false)
  })

  it('accepts a real Workday board, which needs its host and career site', () => {
    expect(
      validateExportBundle(
        withBoards([{ ...board, provider: 'workday', host: 'acme.wd5.myworkdayjobs.com', site: 'AcmeCareers' }])
      ).ok
    ).toBe(true)
  })

  it('rejects a host on a provider that has none, and a Lever host that is not a region', () => {
    expect(validateExportBundle(withBoards([{ ...board, host: 'evil.example.com' }])).ok).toBe(false)
    expect(
      validateExportBundle(withBoards([{ ...board, provider: 'lever', host: 'evil.example.com' }])).ok
    ).toBe(false)
    expect(validateExportBundle(withBoards([{ ...board, provider: 'lever', host: 'api.eu.lever.co' }])).ok).toBe(true)
  })

  it('rejects a token carrying path traversal, which would be interpolated into a URL', () => {
    expect(validateExportBundle(withBoards([{ ...board, token: '../../etc/passwd' }])).ok).toBe(false)
  })

  it('drops a boardKey asserted by the file, since the key is derived on import', () => {
    const result = validateExportBundle(withBoards([{ ...board, boardKey: 'lever:somewhere-else' }]))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.bundle.data.companyBoards?.[0]).not.toHaveProperty('boardKey')
  })

  it('drops the exporting machine\'s last-fetch columns rather than trusting them', () => {
    const result = validateExportBundle(
      withBoards([{ ...board, lastCheckedAt: '2020-06-01T00:00:00.000Z', lastJobCount: 99, lastError: 'boom' }])
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.bundle.data.companyBoards?.[0]).not.toHaveProperty('lastJobCount')
  })
})

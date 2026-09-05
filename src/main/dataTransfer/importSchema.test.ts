import { describe, it, expect } from 'vitest'
import { validateExportBundle } from './importSchema'
import { EXPORT_SCHEMA_VERSION } from '@shared/types/dataTransfer'
import type { ExportBundle } from '@shared/types/dataTransfer'
import { DEFAULT_THEME_STATE, MAX_CSS_PRESETS, MAX_CUSTOM_CSS_LENGTH, MAX_PRESET_NAME_LENGTH } from '@shared/types/theme'

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

  it('accepts notification preferences and rejects malformed values', () => {
    const settings = { autoStartCommand: '', indexedJobsRetentionDays: 30 }
    expect(
      validateExportBundle({
        ...validBundle(),
        data: {
          settings: {
            ...settings,
            notificationPreferences: { enabled: true, verificationRequired: true, jobFilled: false, jobFailed: true }
          }
        }
      }).ok
    ).toBe(true)
    expect(
      validateExportBundle({
        ...validBundle(),
        data: { settings: { ...settings, notificationPreferences: { enabled: true } } }
      }).ok
    ).toBe(false)
  })
})

describe('validateExportBundle — indexed jobs', () => {
  const indexed = {
    url: 'https://example.com/jobs/1',
    title: 'Backend Engineer',
    company: 'Acme',
    location: null,
    source: 'greenhouse',
    snippet: null,
    salaryRange: null,
    postedAt: null,
    searchQuery: 'backend',
    searchLocation: null,
    firstSeenAt: '2020-01-01T00:00:00.000Z',
    lastSeenAt: '2020-01-02T00:00:00.000Z',
    seenCount: 3
  }

  function withIndexed(rows: unknown[]): unknown {
    return { ...validBundle(), data: { indexedJobs: rows } }
  }

  it('accepts a well-formed row', () => {
    const result = validateExportBundle(withIndexed([indexed]))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.bundle.data.indexedJobs).toHaveLength(1)
  })

  it('rejects a row with no url, which is the identity the merge is keyed on', () => {
    expect(validateExportBundle(withIndexed([{ ...indexed, url: '' }])).ok).toBe(false)
  })

  it('rejects a seen count no row could have', () => {
    expect(validateExportBundle(withIndexed([{ ...indexed, seenCount: 0 }])).ok).toBe(false)
    expect(validateExportBundle(withIndexed([{ ...indexed, seenCount: -2 }])).ok).toBe(false)
    expect(validateExportBundle(withIndexed([{ ...indexed, seenCount: 1.5 }])).ok).toBe(false)
  })

  it("drops an id the file asserts, since it is minted on import", () => {
    const result = validateExportBundle(withIndexed([{ ...indexed, id: 'from-the-file' }]))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.bundle.data.indexedJobs?.[0]).not.toHaveProperty('id')
  })

  it('drops the match columns, which are derived from the importing board', () => {
    const result = validateExportBundle(
      withIndexed([{ ...indexed, matchedJobId: 'job-1', matchedStatus: 'queued', matchedScore: 90 }])
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.bundle.data.indexedJobs?.[0]).not.toHaveProperty('matchedJobId')
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

  it("keeps a feed's claimed size, which is a property of the row rather than a reading", () => {
    const result = validateExportBundle(withBoards([{ ...board, seedJobCount: 480 }]))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.bundle.data.companyBoards?.[0]?.seedJobCount).toBe(480)
  })

  it('rejects a claimed size no board could have', () => {
    expect(validateExportBundle(withBoards([{ ...board, seedJobCount: -1 }])).ok).toBe(false)
    expect(validateExportBundle(withBoards([{ ...board, seedJobCount: 2.5 }])).ok).toBe(false)
  })

  it('accepts a board from a bundle written before that field existed', () => {
    expect(validateExportBundle(withBoards([board])).ok).toBe(true)
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

describe('validateExportBundle — theme', () => {
  function withTheme(theme: unknown): unknown {
    return { ...validBundle(), data: { theme } }
  }

  it('accepts the default theme state', () => {
    const result = validateExportBundle(withTheme(DEFAULT_THEME_STATE))
    expect(result.ok).toBe(true)
  })

  it('accepts a customized theme state, presets included', () => {
    const result = validateExportBundle(
      withTheme({
        mode: 'dark',
        accent: '#3c83f6',
        canvasTint: 40,
        customCss: 'body { color: red; }',
        presets: [{ id: 'a', name: 'Compact', css: 'body {}' }],
        activePresetId: 'a'
      })
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.bundle.data.theme?.presets).toHaveLength(1)
  })

  it('rejects an invalid mode, a malformed accent, and an out-of-range canvas tint', () => {
    expect(validateExportBundle(withTheme({ ...DEFAULT_THEME_STATE, mode: 'not-a-mode' })).ok).toBe(false)
    expect(validateExportBundle(withTheme({ ...DEFAULT_THEME_STATE, accent: 'red' })).ok).toBe(false)
    expect(validateExportBundle(withTheme({ ...DEFAULT_THEME_STATE, canvasTint: 400 })).ok).toBe(false)
    expect(validateExportBundle(withTheme({ ...DEFAULT_THEME_STATE, canvasTint: 40.5 })).ok).toBe(false)
  })

  it('rejects custom CSS and a preset name/css over the shared bounds', () => {
    expect(
      validateExportBundle(withTheme({ ...DEFAULT_THEME_STATE, customCss: 'a'.repeat(MAX_CUSTOM_CSS_LENGTH + 1) })).ok
    ).toBe(false)
    expect(
      validateExportBundle(
        withTheme({
          ...DEFAULT_THEME_STATE,
          presets: [{ id: 'a', name: 'a'.repeat(MAX_PRESET_NAME_LENGTH + 1), css: '' }]
        })
      ).ok
    ).toBe(false)
    expect(
      validateExportBundle(
        withTheme({
          ...DEFAULT_THEME_STATE,
          presets: [{ id: 'a', name: 'Compact', css: 'a'.repeat(MAX_CUSTOM_CSS_LENGTH + 1) }]
        })
      ).ok
    ).toBe(false)
  })

  it('rejects more presets than MAX_CSS_PRESETS allows', () => {
    const presets = Array.from({ length: MAX_CSS_PRESETS + 1 }, (_, i) => ({ id: `p${i}`, name: `Preset ${i}`, css: '' }))
    expect(validateExportBundle(withTheme({ ...DEFAULT_THEME_STATE, presets })).ok).toBe(false)
  })

  it('is optional — a bundle with no theme domain is still valid', () => {
    expect(validateExportBundle({ ...validBundle(), data: {} }).ok).toBe(true)
  })
})

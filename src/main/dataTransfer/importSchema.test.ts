import { describe, it, expect } from 'vitest'
import { validateExportBundle } from './importSchema'
import { EXPORT_SCHEMA_VERSION } from '@shared/types/dataTransfer'
import type { ExportBundle } from '@shared/types/dataTransfer'
import { DEFAULT_THEME_STATE, MAX_CSS_PRESETS, MAX_CUSTOM_CSS_LENGTH, MAX_PRESET_NAME_LENGTH } from '@shared/types/theme'
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@shared/types/notification'
import { SAMPLE_RESUME_CONTENT } from '@shared/resume/sampleContent'
import { RESUME_VARIANT_NAME_MAX_CHARS } from '@shared/types/resume'

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
          screenshotPaths: [],
          failureTag: null,
          failureMessage: null,
          blockingReason: null,
          blockingTaskId: null,
          queuedAt: '2020-01-01T00:00:00.000Z',
          filledAt: null,
          submittedAt: null,
          resumeVariantId: null,
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
    const legacyResult = validateExportBundle({
      ...validBundle(),
      data: {
        settings: {
          ...settings,
          notificationPreferences: { enabled: true, verificationRequired: true, jobFilled: false, jobFailed: true }
        }
      }
    })
    expect(legacyResult.ok).toBe(true)
    if (legacyResult.ok) {
      expect(legacyResult.bundle.data.settings?.notificationPreferences?.permissionRequired).toBe(
        DEFAULT_NOTIFICATION_PREFERENCES.permissionRequired
      )
    }
    expect(
      validateExportBundle({
        ...validBundle(),
        data: { settings: { ...settings, notificationPreferences: { enabled: true } } }
      }).ok
    ).toBe(false)
  })

  it('accepts a known search country and rejects an unknown one', () => {
    const settings = { autoStartCommand: '', indexedJobsRetentionDays: 30 }
    expect(validateExportBundle({ ...validBundle(), data: { settings: { ...settings, searchCountry: 'au' } } }).ok).toBe(
      true
    )
    expect(validateExportBundle({ ...validBundle(), data: { settings: { ...settings, searchCountry: 'xx' } } }).ok).toBe(
      false
    )
  })
})

describe('validateExportBundle: resumes and variant names', () => {
  it('accepts variants by name and jobs naming a variant, normalising the names', () => {
    const bundle = validBundle()
    const job = bundle.data.jobs![0]!
    const result = validateExportBundle({
      ...bundle,
      data: {
        jobs: [{ ...job, resumeVariantName: '  Backend   focused ' }, { ...job, id: '2', url: 'https://example.com/2', resumeVariantName: null }],
        resumes: {
          master: { content: SAMPLE_RESUME_CONTENT, templateId: 'classic', pageSize: 'letter' },
          variants: [{ name: ' Backend  focused', content: SAMPLE_RESUME_CONTENT, templateId: 'modern' }]
        }
      }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bundle.data.jobs?.[0]?.resumeVariantName).toBe('Backend focused')
    expect(result.bundle.data.jobs?.[1]?.resumeVariantName).toBeNull()
    expect(result.bundle.data.resumes?.variants[0]?.name).toBe('Backend focused')
  })

  it('never trusts a variant id from the file, and still accepts jobs written before names existed', () => {
    const bundle = validBundle()
    const job = bundle.data.jobs![0]!
    const { resumeVariantId: _dropped, ...legacy } = job
    void _dropped
    const result = validateExportBundle({ ...bundle, data: { jobs: [{ ...legacy, resumeVariantId: 'from-file' }, legacy] } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bundle.data.jobs?.[0]?.resumeVariantId).toBeNull()
    expect(result.bundle.data.jobs?.[1]?.resumeVariantId).toBeNull()
  })

  it('rejects an empty or over-long variant name, and the old per-job variant shape', () => {
    const bundle = validBundle()
    const resumes = { master: null, variants: [{ name: '   ', content: SAMPLE_RESUME_CONTENT, templateId: 'classic' }] }
    expect(validateExportBundle({ ...bundle, data: { resumes } }).ok).toBe(false)
    resumes.variants[0]!.name = 'x'.repeat(RESUME_VARIANT_NAME_MAX_CHARS + 1)
    expect(validateExportBundle({ ...bundle, data: { resumes } }).ok).toBe(false)
    const legacy = { master: null, variants: [{ jobId: 'j', content: SAMPLE_RESUME_CONTENT, templateId: 'classic' }] }
    expect(validateExportBundle({ ...bundle, data: { resumes: legacy } }).ok).toBe(false)
    const job = bundle.data.jobs![0]!
    expect(validateExportBundle({ ...bundle, data: { jobs: [{ ...job, resumeVariantName: '' }] } }).ok).toBe(false)
  })

  it('rejects resume content with duplicate ids in the master or a variant', () => {
    const bundle = validBundle()
    const [first] = SAMPLE_RESUME_CONTENT.sections
    const duplicated = { ...SAMPLE_RESUME_CONTENT, sections: [first!, { ...first!, title: 'Again' }] }
    const okContent = { master: { content: SAMPLE_RESUME_CONTENT, templateId: 'classic', pageSize: 'letter' }, variants: [] }
    expect(validateExportBundle({ ...bundle, data: { resumes: okContent } }).ok).toBe(true)

    const badMaster = { master: { content: duplicated, templateId: 'classic', pageSize: 'letter' }, variants: [] }
    expect(validateExportBundle({ ...bundle, data: { resumes: badMaster } }).ok).toBe(false)

    const badVariant = { master: null, variants: [{ name: 'Backend', content: duplicated, templateId: 'classic' }] }
    expect(validateExportBundle({ ...bundle, data: { resumes: badVariant } }).ok).toBe(false)
  })
})

describe('validateExportBundle — job descriptions', () => {
  function bundleWithDescription(description: string): unknown {
    const bundle = validBundle()
    bundle.data.jobs![0]!.description = description
    return bundle
  }

  function importedDescription(description: string): string | null {
    const result = validateExportBundle(bundleWithDescription(description))
    if (!result.ok) throw new Error('Expected the bundle to validate')
    return result.bundle.data.jobs![0]!.description
  }

  // The column is rendered with `dangerouslySetInnerHTML` in the job detail
  // modal. Every other writer already sanitizes (the scrapers at fetch,
  // `queue_job` at the tool boundary); a bundle is a file, and was the one
  // door that stored whatever it was handed.
  it('strips script tags from an imported description', () => {
    expect(importedDescription('<p>Real role</p><script>alert(1)</script>')).toBe('<p>Real role</p>')
  })

  it('strips event handlers and non-http schemes', () => {
    expect(importedDescription('<img src=x onerror="alert(1)">')).not.toContain('onerror')
    expect(importedDescription('<a href="javascript:alert(1)">apply</a>')).not.toContain('javascript:')
  })

  it('keeps the formatting a real posting uses', () => {
    const description = importedDescription('<p>We need a <strong>backend</strong> engineer.</p><ul><li>Go</li></ul>')
    expect(description).toContain('<strong>backend</strong>')
    expect(description).toContain('<li>Go</li>')
  })

  it('leaves a null description null rather than turning it into an empty string', () => {
    const result = validateExportBundle(validBundle())
    expect(result.ok && result.bundle.data.jobs![0]!.description).toBeNull()
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

describe('validateExportBundle: agent mode and OpenRouter settings', () => {
  const baseSettings = { autoStartCommand: '', indexedJobsRetentionDays: 30 }

  it('accepts a known agent mode and rejects an unknown one', () => {
    expect(
      validateExportBundle({ ...validBundle(), data: { settings: { ...baseSettings, agentMode: 'openrouter' } } }).ok
    ).toBe(true)
    expect(
      validateExportBundle({ ...validBundle(), data: { settings: { ...baseSettings, agentMode: 'terminal' } } }).ok
    ).toBe(false)
  })

  it('accepts well-formed OpenRouter settings and rejects a malformed reasoning effort or tool list', () => {
    const openrouter = { modelId: 'deepseek/deepseek-v4.1-flash', reasoningEffort: 'high', toolApproval: { askFor: ['queue_job'] } }
    expect(validateExportBundle({ ...validBundle(), data: { settings: { ...baseSettings, openrouter } } }).ok).toBe(true)
    expect(
      validateExportBundle({
        ...validBundle(),
        data: { settings: { ...baseSettings, openrouter: { ...openrouter, reasoningEffort: 'extreme' } } }
      }).ok
    ).toBe(false)
    expect(
      validateExportBundle({
        ...validBundle(),
        data: { settings: { ...baseSettings, openrouter: { ...openrouter, toolApproval: { askFor: [1, 2] } } } }
      }).ok
    ).toBe(false)
  })

  it('is optional, a bundle with no agent mode or OpenRouter settings is still valid', () => {
    expect(validateExportBundle({ ...validBundle(), data: { settings: baseSettings } }).ok).toBe(true)
  })
})

describe('validateExportBundle: chats', () => {
  function chatSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      title: 'Untitled',
      modelId: 'deepseek/deepseek-v4.1-flash',
      createdAt: '2020-01-01T00:00:00.000Z',
      messages: [
        {
          role: 'user',
          content: 'Find me backend jobs',
          reasoning: null,
          toolCalls: null,
          toolCallId: null,
          modelId: null,
          usage: null,
          createdAt: '2020-01-01T00:00:00.000Z'
        },
        {
          role: 'assistant',
          content: 'On it.',
          reasoning: 'Thinking about it',
          toolCalls: [
            {
              id: 'call-1',
              name: 'search_jobs',
              arguments: '{"query":"backend"}',
              status: 'done',
              result: 'ok',
              isError: false,
              durationMs: 500
            }
          ],
          toolCallId: null,
          modelId: 'deepseek/deepseek-v4.1-flash',
          usage: { promptTokens: 10, completionTokens: 20, costUsd: 0.001 },
          createdAt: '2020-01-01T00:00:01.000Z'
        }
      ],
      ...overrides
    }
  }

  it('accepts a well-formed chat session', () => {
    const result = validateExportBundle({ ...validBundle(), data: { chats: [chatSession()] } })
    expect(result.ok).toBe(true)
  })

  it('is optional, a bundle with no chats domain is still valid', () => {
    expect(validateExportBundle({ ...validBundle(), data: {} }).ok).toBe(true)
  })

  it('rejects a session with an empty modelId', () => {
    expect(validateExportBundle({ ...validBundle(), data: { chats: [chatSession({ modelId: '' })] } }).ok).toBe(false)
  })

  it('rejects a message with an unknown role', () => {
    const session = chatSession()
    const messages = session.messages as Array<Record<string, unknown>>
    messages[0] = { ...messages[0], role: 'system' }
    expect(validateExportBundle({ ...validBundle(), data: { chats: [session] } }).ok).toBe(false)
  })

  it('rejects a tool call with an unknown status', () => {
    const session = chatSession()
    const messages = session.messages as Array<Record<string, unknown>>
    const toolCalls = messages[1]!.toolCalls as Array<Record<string, unknown>>
    toolCalls[0] = { ...toolCalls[0], status: 'bogus' }
    expect(validateExportBundle({ ...validBundle(), data: { chats: [session] } }).ok).toBe(false)
  })

  it('drops unknown fields on a message rather than rejecting the session', () => {
    const session = chatSession()
    const messages = session.messages as Array<Record<string, unknown>>
    messages[0] = { ...messages[0], id: 'should-be-dropped', sessionId: 'should-be-dropped' }
    const result = validateExportBundle({ ...validBundle(), data: { chats: [session] } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bundle.data.chats?.[0]?.messages[0]).not.toHaveProperty('id')
    expect(result.bundle.data.chats?.[0]?.messages[0]).not.toHaveProperty('sessionId')
  })
})

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

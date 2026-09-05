import { describe, expect, it } from 'vitest'
import {
  DANGEROUS_SETTING_KEYS,
  defaultSettings,
  isAdvancedSettingsSnapshot,
  parseSettingsOverride
} from './settings'

describe('parseSettingsOverride', () => {
  it('merges a valid partial override over the shipped defaults', () => {
    const result = parseSettingsOverride({ listJobsDefaultLimit: 25, atsFetchTimeoutMs: 20_000 })

    expect(result.warnings).toEqual([])
    expect(result.settings.listJobsDefaultLimit).toBe(25)
    expect(result.settings.atsFetchTimeoutMs).toBe(20_000)
    expect(result.settings.searchJobsDefaultLimit).toBe(defaultSettings().searchJobsDefaultLimit)
  })

  it('ignores unknown and invalid entries independently', () => {
    const defaults = defaultSettings()
    const result = parseSettingsOverride({
      notASetting: true,
      atsFetchTimeoutMs: -1,
      boardCsvPreviewRows: 8
    })

    expect(result.settings.atsFetchTimeoutMs).toBe(defaults.atsFetchTimeoutMs)
    expect(result.settings.boardCsvPreviewRows).toBe(8)
    expect(result.warnings).toHaveLength(2)
  })

  it('rejects a maximum that is lower than its default page size', () => {
    const defaults = defaultSettings()
    const result = parseSettingsOverride({ dangerousListJobsMaxLimit: 10 })

    expect(result.settings.dangerousListJobsMaxLimit).toBe(defaults.dangerousListJobsMaxLimit)
    expect(result.settings.listJobsDefaultLimit).toBe(defaults.listJobsDefaultLimit)
    expect(result.warnings).toHaveLength(1)
  })

  it('accepts a coordinated default and maximum override', () => {
    const result = parseSettingsOverride({
      listJobsDefaultLimit: 75,
      dangerousListJobsMaxLimit: 100
    })

    expect(result.warnings).toEqual([])
    expect(result.settings.listJobsDefaultLimit).toBe(75)
    expect(result.settings.dangerousListJobsMaxLimit).toBe(100)
  })

  it('requires the retention default to remain one of the offered options', () => {
    const defaults = defaultSettings()
    const result = parseSettingsOverride({ indexedJobsRetentionOptions: [14, 90, 'unlimited'] })

    expect(result.settings.indexedJobsRetentionOptions).toEqual(defaults.indexedJobsRetentionOptions)
    expect(result.warnings).toHaveLength(1)
  })

  it('gives every safeguard setting the dangerous prefix', () => {
    expect(DANGEROUS_SETTING_KEYS.length).toBeGreaterThan(0)
    expect(DANGEROUS_SETTING_KEYS.every((key) => key.startsWith('dangerous'))).toBe(true)
  })

  it('validates advanced settings snapshots received over IPC', () => {
    const defaults = defaultSettings()
    expect(
      isAdvancedSettingsSnapshot({
        defaults,
        configured: defaults,
        overriddenKeys: [],
        warnings: [],
        restartRequired: false
      })
    ).toBe(true)
    expect(
      isAdvancedSettingsSnapshot({
        defaults,
        configured: { ...defaults, atsFetchTimeoutMs: 'slow' },
        overriddenKeys: [],
        warnings: [],
        restartRequired: false
      })
    ).toBe(false)
  })
})

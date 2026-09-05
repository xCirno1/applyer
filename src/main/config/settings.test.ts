import { readFileSync, writeFileSync } from 'fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { __resetElectronMock } from '../../../test/mocks/electron'
import { defaultSettings, getSettings, setSettingsForProcess } from '@shared/settings'
import {
  getAdvancedSettingsSnapshot,
  loadUserSettings,
  resetUserSetting,
  updateUserSetting,
  userSettingsPath
} from './settings'

describe('user settings', () => {
  beforeEach(() => {
    __resetElectronMock()
    setSettingsForProcess(defaultSettings())
  })

  it('creates an empty partial override file on first load', () => {
    const result = loadUserSettings()

    expect(result.warnings).toEqual([])
    expect(readFileSync(result.path, 'utf-8')).toBe('{}\n')
    expect(getSettings()).toEqual(defaultSettings())
  })

  it('loads valid values and reports invalid siblings without failing startup', () => {
    const path = userSettingsPath()
    writeFileSync(path, JSON.stringify({ listJobsDefaultLimit: 25, atsFetchTimeoutMs: 'slow' }))

    const result = loadUserSettings()

    expect(getSettings().listJobsDefaultLimit).toBe(25)
    expect(getSettings().atsFetchTimeoutMs).toBe(defaultSettings().atsFetchTimeoutMs)
    expect(result.warnings).toHaveLength(1)
  })

  it('falls back to defaults for malformed JSON', () => {
    const path = userSettingsPath()
    writeFileSync(path, '{')

    const result = loadUserSettings()

    expect(result.warnings).toHaveLength(1)
    expect(getSettings()).toEqual(defaultSettings())
  })

  it('writes and resets one UI override without changing the running settings', () => {
    loadUserSettings()

    const updated = updateUserSetting('atsFetchTimeoutMs', 20_000)
    expect(updated.configured.atsFetchTimeoutMs).toBe(20_000)
    expect(updated.overriddenKeys).toContain('atsFetchTimeoutMs')
    expect(updated.restartRequired).toBe(true)
    expect(getSettings().atsFetchTimeoutMs).toBe(defaultSettings().atsFetchTimeoutMs)

    const reset = resetUserSetting('atsFetchTimeoutMs')
    expect(reset.configured.atsFetchTimeoutMs).toBe(defaultSettings().atsFetchTimeoutMs)
    expect(reset.overriddenKeys).not.toContain('atsFetchTimeoutMs')
    expect(reset.restartRequired).toBe(false)
  })

  it('rejects an invalid UI override and leaves the file unchanged', () => {
    loadUserSettings()

    expect(() => updateUserSetting('atsFetchTimeoutMs', -1)).toThrow(/Invalid value/)
    expect(getAdvancedSettingsSnapshot().overriddenKeys).not.toContain('atsFetchTimeoutMs')
  })
})

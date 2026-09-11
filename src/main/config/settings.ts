import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  defaultSettings,
  isSettingKey,
  parseSettingsOverride,
  serializeSettings,
  setSettingsForProcess,
  type AdvancedSettingsSnapshot,
  type ApplyerSettingKey,
  type ApplyerSettingsOverride
} from '@shared/settings'

export const USER_SETTINGS_FILENAME = 'settings.json'

export interface UserSettingsLoadResult {
  path: string
  warnings: string[]
}

export function userSettingsPath(): string {
  return join(app.getPath('userData'), USER_SETTINGS_FILENAME)
}

interface OverrideReadResult {
  override: Record<string, unknown>
  warnings: string[]
}

function readOverrideFile(createIfMissing: boolean): OverrideReadResult {
  const path = userSettingsPath()
  try {
    if (!existsSync(path)) {
      if (!createIfMissing) return { override: {}, warnings: [] }
      mkdirSync(app.getPath('userData'), { recursive: true })
      writeFileSync(path, '{}\n', { encoding: 'utf-8', flag: 'wx' })
      return { override: {}, warnings: [] }
    }
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { override: {}, warnings: ['The settings override must be a JSON object.'] }
    }
    return { override: parsed as Record<string, unknown>, warnings: [] }
  } catch (error) {
    return { override: {}, warnings: [`Could not read ${path}; shipped defaults will be used (${String(error)}).`] }
  }
}

function writeOverrideFile(override: Record<string, unknown>): void {
  const path = userSettingsPath()
  const temporaryPath = `${path}.tmp`
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(temporaryPath, `${JSON.stringify(override, null, 2)}\n`, 'utf-8')
  renameSync(temporaryPath, path)
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * Loads the user's partial JSON override before the rest of the application is
 * imported. A missing file is created as an empty object so new defaults in a
 * later release are inherited instead of being frozen into an old full copy.
 */
export function loadUserSettings(): UserSettingsLoadResult {
  const path = userSettingsPath()
  const read = readOverrideFile(true)
  const parsed = parseSettingsOverride(read.override)
  setSettingsForProcess(parsed.settings)
  return { path, warnings: [...read.warnings, ...parsed.warnings] }
}

export function encodedSettingsArgument(): string {
  return `--applyer-settings=${encodeURIComponent(JSON.stringify(serializeSettings()))}`
}

export function getAdvancedSettingsSnapshot(): AdvancedSettingsSnapshot {
  const read = readOverrideFile(true)
  const parsed = parseSettingsOverride(read.override)
  return {
    defaults: defaultSettings(),
    configured: parsed.settings,
    overriddenKeys: Object.keys(read.override).filter(
      (key): key is ApplyerSettingKey => isSettingKey(key) && valuesEqual(parsed.settings[key], read.override[key])
    ),
    warnings: [...read.warnings, ...parsed.warnings],
    restartRequired: !valuesEqual(parsed.settings, serializeSettings())
  }
}

export function updateUserSetting(key: ApplyerSettingKey, value: unknown): AdvancedSettingsSnapshot {
  const read = readOverrideFile(true)
  const candidate = { ...read.override, [key]: value }
  const parsed = parseSettingsOverride(candidate)
  if (!valuesEqual(parsed.settings[key], value)) {
    const reason = parsed.warnings.find((warning) => warning.includes(`"${key}"`))
    throw new Error(reason ?? `Invalid value for setting "${key}".`)
  }
  writeOverrideFile(candidate)
  return getAdvancedSettingsSnapshot()
}

export function resetUserSetting(key: ApplyerSettingKey): AdvancedSettingsSnapshot {
  const read = readOverrideFile(true)
  const candidate: ApplyerSettingsOverride & Record<string, unknown> = { ...read.override }
  delete candidate[key]
  writeOverrideFile(candidate)
  return getAdvancedSettingsSnapshot()
}

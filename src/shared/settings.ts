import defaultSettingsJson from './settings.json'

export interface ApplyerSettings {
  dangerousBuiltinFailureTags: Array<{ id: string; label: string; description: string }>
  listJobsDefaultLimit: number
  dangerousListJobsMaxLimit: number
  searchJobsDefaultLimit: number
  dangerousSearchJobsMaxLimit: number
  listExclusionsDefaultLimit: number
  dangerousListExclusionsMaxLimit: number
  listIndexedJobsDefaultLimit: number
  dangerousListIndexedJobsMaxLimit: number
  indexedJobsRetentionOptions: Array<number | 'unlimited'>
  indexedJobsRetentionDefaultDays: number
  jobDetailsCacheTtlMs: number
  dangerousJobDetailsCachePayloadVersion: number
  dangerousMaxDocumentSizeBytes: number
  dangerousMaxCompanyBoards: number
  listCompanyBoardsDefaultLimit: number
  dangerousMcpListCompanyBoardsMaxLimit: number
  dangerousMaxBoardCsvBytes: number
  dangerousMaxBoardCsvRows: number
  boardCsvPreviewRows: number
  dangerousMaxManualBoardFetch: number
  dangerousManualBoardFetchLimit: number
  dangerousMaxAtsBoardsPerSearch: number
  atsSweepRotationShare: number
  dangerousAtsFetchConcurrency: number
  atsFetchTimeoutMs: number
  atsBoardCacheTtlMs: number
  atsBoardNotFoundCacheTtlMs: number
  atsBoardErrorCacheTtlMs: number
  dangerousAtsBoardCacheMaxEntries: number
  dangerousMaxSlugCandidates: number
  dangerousAtsProbeConcurrency: number
  atsProbeTimeoutMs: number
  notificationEnabledByDefault: boolean
  notificationVerificationRequiredByDefault: boolean
  notificationJobFilledByDefault: boolean
  notificationJobFailedByDefault: boolean
  notificationDefaultLocale: 'en' | 'id'
  dangerousAutoStartCommandMaxLength: number
}

export type ApplyerSettingsOverride = Partial<ApplyerSettings>
export type ApplyerSettingKey = keyof ApplyerSettings
export type ApplyerSettingValue = ApplyerSettings[ApplyerSettingKey]

export interface AdvancedSettingsSnapshot {
  defaults: ApplyerSettings
  configured: ApplyerSettings
  overriddenKeys: ApplyerSettingKey[]
  warnings: string[]
  restartRequired: boolean
}

export interface SettingsParseResult {
  settings: ApplyerSettings
  warnings: string[]
}

const DEFAULT_SETTINGS: ApplyerSettings = defaultSettingsJson as ApplyerSettings
export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as ApplyerSettingKey[]
const SETTING_KEY_SET = new Set<string>(SETTING_KEYS)

/**
 * These settings relax resource, network, or data-integrity safeguards. Their
 * deliberately noisy names make a copied override self-documenting.
 */
export const DANGEROUS_SETTING_KEYS = SETTING_KEYS.filter((key) => key.startsWith('dangerous'))

export function isSettingKey(value: unknown): value is ApplyerSettingKey {
  return typeof value === 'string' && SETTING_KEY_SET.has(value)
}

function cloneDefaults(): ApplyerSettings {
  return structuredClone(DEFAULT_SETTINGS)
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function validateSetting(key: keyof ApplyerSettings, value: unknown): boolean {
  if (key === 'dangerousBuiltinFailureTags') {
    return (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every(
        (item) =>
          isObject(item) &&
          typeof item.id === 'string' &&
          /^[a-z][a-z0-9_]{1,39}$/.test(item.id) &&
          typeof item.label === 'string' &&
          item.label.trim().length > 0 &&
          typeof item.description === 'string' &&
          item.description.trim().length > 0
      )
    )
  }
  if (key === 'indexedJobsRetentionOptions') {
    return (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((item) => item === 'unlimited' || isPositiveInteger(item))
    )
  }
  if (key === 'atsSweepRotationShare') {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
  }
  if (key === 'notificationDefaultLocale') return value === 'en' || value === 'id'
  const defaultValue = DEFAULT_SETTINGS[key]
  if (typeof defaultValue === 'boolean') return typeof value === 'boolean'
  if (typeof defaultValue === 'string') return typeof value === 'string'
  return isPositiveInteger(value)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Applies a partial, untrusted JSON object over the shipped defaults. Invalid
 * entries are ignored independently so one typo cannot discard valid sibling
 * overrides or prevent the app from starting.
 */
export function parseSettingsOverride(value: unknown): SettingsParseResult {
  const settings = cloneDefaults()
  const warnings: string[] = []
  const overriddenKeys = new Set<keyof ApplyerSettings>()

  if (!isObject(value)) {
    return { settings, warnings: ['The settings override must be a JSON object.'] }
  }

  for (const [rawKey, candidate] of Object.entries(value)) {
    if (!SETTING_KEY_SET.has(rawKey)) {
      warnings.push(`Unknown setting "${rawKey}" was ignored.`)
      continue
    }
    const key = rawKey as keyof ApplyerSettings
    if (!validateSetting(key, candidate)) {
      warnings.push(`Invalid value for setting "${rawKey}" was ignored.`)
      continue
    }
    ;(settings as unknown as Record<string, unknown>)[key] = structuredClone(candidate)
    overriddenKeys.add(key)
  }

  const limitPairs: Array<[keyof ApplyerSettings, keyof ApplyerSettings]> = [
    ['listJobsDefaultLimit', 'dangerousListJobsMaxLimit'],
    ['searchJobsDefaultLimit', 'dangerousSearchJobsMaxLimit'],
    ['listExclusionsDefaultLimit', 'dangerousListExclusionsMaxLimit'],
    ['listIndexedJobsDefaultLimit', 'dangerousListIndexedJobsMaxLimit'],
    ['listCompanyBoardsDefaultLimit', 'dangerousMaxCompanyBoards']
  ]
  for (const [defaultKey, maxKey] of limitPairs) {
    if ((settings[defaultKey] as number) <= (settings[maxKey] as number)) continue
    const resetKeys = overriddenKeys.has(defaultKey) && overriddenKeys.has(maxKey) ? [defaultKey, maxKey] :
      overriddenKeys.has(maxKey) ? [maxKey] : [defaultKey]
    for (const key of resetKeys) settings[key] = structuredClone(DEFAULT_SETTINGS[key]) as never
    warnings.push(
      `Setting "${String(defaultKey)}" cannot exceed "${String(maxKey)}"; conflicting override values were ignored.`
    )
  }

  if (!settings.indexedJobsRetentionOptions.includes(settings.indexedJobsRetentionDefaultDays)) {
    const optionsKey = 'indexedJobsRetentionOptions'
    const defaultKey = 'indexedJobsRetentionDefaultDays'
    const resetKeys = overriddenKeys.has(optionsKey) && overriddenKeys.has(defaultKey) ? [optionsKey, defaultKey] :
      overriddenKeys.has(optionsKey) ? [optionsKey] : [defaultKey]
    for (const key of resetKeys) settings[key] = structuredClone(DEFAULT_SETTINGS[key]) as never
    warnings.push(
      'Setting "indexedJobsRetentionDefaultDays" must be present in "indexedJobsRetentionOptions"; conflicting override values were ignored.'
    )
  }

  return { settings, warnings }
}

function injectedRendererSettings(): unknown {
  return (globalThis as typeof globalThis & { applyerSettings?: unknown }).applyerSettings
}

let effectiveSettings = parseSettingsOverride(injectedRendererSettings() ?? {}).settings

export function getSettings(): Readonly<ApplyerSettings> {
  return effectiveSettings
}

/** Main-process startup hook. It must run before importing the application bootstrap. */
export function setSettingsForProcess(settings: ApplyerSettings): void {
  effectiveSettings = structuredClone(settings)
}

/** A detached object safe to pass into a sandboxed renderer. */
export function serializeSettings(): ApplyerSettings {
  return structuredClone(effectiveSettings)
}

export function defaultSettings(): ApplyerSettings {
  return cloneDefaults()
}

export function isAdvancedSettingsSnapshot(value: unknown): value is AdvancedSettingsSnapshot {
  if (!isObject(value)) return false
  const defaults = value.defaults
  const configured = value.configured
  if (!isObject(defaults) || !isObject(configured)) return false
  if (!SETTING_KEYS.every((key) => validateSetting(key, defaults[key]) && validateSetting(key, configured[key]))) {
    return false
  }
  return (
    Array.isArray(value.overriddenKeys) &&
    value.overriddenKeys.every(isSettingKey) &&
    Array.isArray(value.warnings) &&
    value.warnings.every((warning) => typeof warning === 'string') &&
    typeof value.restartRequired === 'boolean'
  )
}

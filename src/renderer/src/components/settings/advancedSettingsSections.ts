import { SETTING_KEYS, type ApplyerSettingKey } from '@shared/settings'

export interface AdvancedSettingsGroup {
  id: string
  keys: ApplyerSettingKey[]
}

export interface AdvancedSettingsSection {
  id: string
  groups: AdvancedSettingsGroup[]
}

/** Presentation-only hierarchy. Defaults and user values still come exclusively from settings.json. */
export const ADVANCED_SETTINGS_SECTIONS: AdvancedSettingsSection[] = [
  {
    id: 'system',
    groups: [{ id: 'failureTags', keys: ['dangerousBuiltinFailureTags'] }]
  },
  {
    id: 'documents',
    groups: [{ id: 'uploads', keys: ['dangerousMaxDocumentSizeBytes'] }]
  },
  {
    id: 'jobs',
    groups: [
      {
        id: 'listing',
        keys: [
          'listJobsDefaultLimit',
          'dangerousListJobsMaxLimit',
          'searchJobsDefaultLimit',
          'dangerousSearchJobsMaxLimit'
        ]
      },
      {
        id: 'indexedJobs',
        keys: [
          'listIndexedJobsDefaultLimit',
          'dangerousListIndexedJobsMaxLimit',
          'indexedJobsRetentionOptions',
          'indexedJobsRetentionDefaultDays'
        ]
      },
      {
        id: 'exclusions',
        keys: ['listExclusionsDefaultLimit', 'dangerousListExclusionsMaxLimit']
      },
      {
        id: 'detailsCache',
        keys: ['jobDetailsCacheTtlMs', 'dangerousJobDetailsCachePayloadVersion']
      }
    ]
  },
  {
    id: 'companyBoards',
    groups: [
      {
        id: 'capacity',
        keys: [
          'dangerousMaxCompanyBoards',
          'listCompanyBoardsDefaultLimit',
          'dangerousMcpListCompanyBoardsMaxLimit'
        ]
      },
      {
        id: 'csvImport',
        keys: ['dangerousMaxBoardCsvBytes', 'dangerousMaxBoardCsvRows', 'boardCsvPreviewRows']
      },
      {
        id: 'fetching',
        keys: [
          'dangerousMaxManualBoardFetch',
          'dangerousManualBoardFetchLimit',
          'dangerousMaxAtsBoardsPerSearch',
          'atsSweepRotationShare',
          'dangerousAtsFetchConcurrency',
          'atsFetchTimeoutMs',
          'dangerousMaxSlugCandidates',
          'dangerousAtsProbeConcurrency',
          'atsProbeTimeoutMs'
        ]
      },
      {
        id: 'cache',
        keys: [
          'atsBoardCacheTtlMs',
          'atsBoardNotFoundCacheTtlMs',
          'atsBoardErrorCacheTtlMs',
          'dangerousAtsBoardCacheMaxEntries'
        ]
      }
    ]
  },
  {
    id: 'notifications',
    groups: [
      {
        id: 'notificationDefaults',
        keys: [
          'notificationEnabledByDefault',
          'notificationVerificationRequiredByDefault',
          'notificationJobFilledByDefault',
          'notificationJobFailedByDefault',
          'notificationDefaultLocale'
        ]
      }
    ]
  },
  {
    id: 'terminal',
    groups: [{ id: 'commands', keys: ['dangerousAutoStartCommandMaxLength'] }]
  }
]

export function ungroupedSettingKeys(): ApplyerSettingKey[] {
  const grouped = new Set(ADVANCED_SETTINGS_SECTIONS.flatMap((section) => section.groups.flatMap((group) => group.keys)))
  return SETTING_KEYS.filter((key) => !grouped.has(key))
}

export function duplicateSettingKeys(): ApplyerSettingKey[] {
  const keys = ADVANCED_SETTINGS_SECTIONS.flatMap((section) => section.groups.flatMap((group) => group.keys))
  return [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))]
}

function normalizeSearchText(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '')
}

export function searchAdvancedSettingsSections(
  query: string,
  labels: Record<string, string> = {}
): AdvancedSettingsSection[] {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) return ADVANCED_SETTINGS_SECTIONS

  return ADVANCED_SETTINGS_SECTIONS.flatMap((section) => {
    const sectionMatches = [section.id, labels[section.id] ?? '']
      .map(normalizeSearchText)
      .some((value) => value.includes(normalizedQuery))
    const groups = section.groups.flatMap((group) => {
      const groupMatches = [group.id, labels[group.id] ?? '']
        .map(normalizeSearchText)
        .some((value) => value.includes(normalizedQuery))
      const keys = sectionMatches || groupMatches
        ? group.keys
        : group.keys.filter((key) => normalizeSearchText(key).includes(normalizedQuery))
      return keys.length > 0 ? [{ ...group, keys }] : []
    })
    return groups.length > 0 ? [{ ...section, groups }] : []
  })
}

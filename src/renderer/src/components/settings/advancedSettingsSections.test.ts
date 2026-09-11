import { describe, expect, it } from 'vitest'
import {
  duplicateSettingKeys,
  searchAdvancedSettingsSections,
  ungroupedSettingKeys
} from './advancedSettingsSections'

describe('advanced settings hierarchy', () => {
  it('contains every setting exactly once', () => {
    expect(ungroupedSettingKeys()).toEqual([])
    expect(duplicateSettingKeys()).toEqual([])
  })

  it('searches keys and preserves their section/group path', () => {
    const result = searchAdvancedSettingsSections('fetch timeout')

    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('companyBoards')
    expect(result[0]?.groups).toEqual([{ id: 'fetching', keys: ['atsFetchTimeoutMs'] }])
  })

  it('matches a section or localized group label', () => {
    expect(searchAdvancedSettingsSections('company boards')[0]?.id).toBe('companyBoards')
    const localized = searchAdvancedSettingsSections('unggahan', { uploads: 'Batas unggahan' })
    expect(localized[0]?.groups[0]?.id).toBe('uploads')
  })
})

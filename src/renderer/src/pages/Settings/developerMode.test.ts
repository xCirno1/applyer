import { describe, expect, it, vi } from 'vitest'
import { DEVELOPER_MODE_STORAGE_KEY, readDeveloperMode, writeDeveloperMode } from './developerMode'

describe('developer mode preference', () => {
  it('is disabled unless the stored value is exactly true', () => {
    expect(readDeveloperMode({ getItem: () => null })).toBe(false)
    expect(readDeveloperMode({ getItem: () => '1' })).toBe(false)
    expect(readDeveloperMode({ getItem: () => 'true' })).toBe(true)
  })

  it('persists the toggle', () => {
    const setItem = vi.fn()
    writeDeveloperMode(true, { setItem })
    expect(setItem).toHaveBeenCalledWith(DEVELOPER_MODE_STORAGE_KEY, 'true')
  })

  it('fails closed when storage is unavailable', () => {
    expect(readDeveloperMode({ getItem: () => { throw new Error('blocked') } })).toBe(false)
    expect(() => writeDeveloperMode(true, { setItem: () => { throw new Error('full') } })).not.toThrow()
  })
})

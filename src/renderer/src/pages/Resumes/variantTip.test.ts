// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VARIANT_TIP_STORAGE_KEY, readVariantTipDismissed, writeVariantTipDismissed } from './variantTip'

beforeEach(() => window.localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('variantTip', () => {
  it('shows the tip until it is dismissed', () => {
    expect(readVariantTipDismissed()).toBe(false)
    writeVariantTipDismissed()
    expect(readVariantTipDismissed()).toBe(true)
    expect(window.localStorage.getItem(VARIANT_TIP_STORAGE_KEY)).toBe('1')
  })

  it('treats any other stored value as not dismissed', () => {
    window.localStorage.setItem(VARIANT_TIP_STORAGE_KEY, 'yes')
    expect(readVariantTipDismissed()).toBe(false)
  })

  it('falls back to showing the tip when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readVariantTipDismissed()).toBe(false)
    expect(() => writeVariantTipDismissed()).not.toThrow()
  })
})

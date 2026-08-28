// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  LOCALE_STORAGE_KEY,
  FALLBACK_LOCALE,
  SUPPORTED_LOCALES,
  isLocaleCode,
  isLocalePreference,
  parseLocalePreference,
  readStoredLocale,
  writeStoredLocale,
  matchSystemLocale,
  resolveLocale,
  localeNativeName
} from './locale'

beforeEach(() => {
  window.localStorage.clear()
})

describe('isLocaleCode', () => {
  it('accepts every supported code', () => {
    for (const { code } of SUPPORTED_LOCALES) expect(isLocaleCode(code)).toBe(true)
  })

  it('rejects unsupported codes, regional tags, and non-strings', () => {
    expect(isLocaleCode('fr')).toBe(false)
    // Regional tags are matched by matchSystemLocale, not treated as codes.
    expect(isLocaleCode('en-GB')).toBe(false)
    expect(isLocaleCode(null)).toBe(false)
    expect(isLocaleCode(42)).toBe(false)
  })
})

describe('isLocalePreference', () => {
  it("accepts 'system' as well as concrete codes", () => {
    expect(isLocalePreference('system')).toBe(true)
    expect(isLocalePreference('id')).toBe(true)
    expect(isLocalePreference('de')).toBe(false)
  })
})

describe('parseLocalePreference', () => {
  it('passes through valid preferences', () => {
    expect(parseLocalePreference('id')).toBe('id')
    expect(parseLocalePreference('system')).toBe('system')
  })

  it("falls back to 'system' for anything unrecognised", () => {
    // This is user-writable storage — an unknown code reaching i18next would
    // render every key as its raw id.
    expect(parseLocalePreference('klingon')).toBe('system')
    expect(parseLocalePreference(null)).toBe('system')
    expect(parseLocalePreference({ code: 'id' })).toBe('system')
    expect(parseLocalePreference(['id'])).toBe('system')
  })
})

describe('stored locale', () => {
  it('round-trips through localStorage', () => {
    writeStoredLocale('id')
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('id')
    expect(readStoredLocale()).toBe('id')
  })

  it("returns 'system' when nothing is stored", () => {
    expect(readStoredLocale()).toBe('system')
  })

  it('ignores a corrupted stored value', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'not-a-locale')
    expect(readStoredLocale()).toBe('system')
  })
})

describe('matchSystemLocale', () => {
  it('matches an exact supported code', () => {
    expect(matchSystemLocale(['id'])).toBe('id')
  })

  it('matches on the base subtag of a regional tag', () => {
    // What navigator.languages actually reports on most systems.
    expect(matchSystemLocale(['id-ID'])).toBe('id')
    expect(matchSystemLocale(['en-GB'])).toBe('en')
  })

  it('is case-insensitive', () => {
    expect(matchSystemLocale(['ID-id'])).toBe('id')
  })

  it('takes the first supported entry, skipping unsupported ones', () => {
    expect(matchSystemLocale(['fr-FR', 'de', 'id-ID', 'en'])).toBe('id')
  })

  it('falls back when nothing matches or the list is empty/absent', () => {
    expect(matchSystemLocale(['fr', 'de'])).toBe(FALLBACK_LOCALE)
    expect(matchSystemLocale([])).toBe(FALLBACK_LOCALE)
    expect(matchSystemLocale(undefined)).toBe(FALLBACK_LOCALE)
  })

  it('skips non-string entries rather than throwing', () => {
    expect(matchSystemLocale([null as unknown as string, 'id'])).toBe('id')
  })
})

describe('resolveLocale', () => {
  it("resolves 'system' against the language list", () => {
    expect(resolveLocale('system', ['id-ID'])).toBe('id')
    expect(resolveLocale('system', ['fr'])).toBe(FALLBACK_LOCALE)
  })

  it('ignores the language list for an explicit choice', () => {
    expect(resolveLocale('en', ['id-ID'])).toBe('en')
    expect(resolveLocale('id', ['en-US'])).toBe('id')
  })
})

describe('localeNativeName', () => {
  it('names each supported locale in its own script', () => {
    for (const { code, nativeName } of SUPPORTED_LOCALES) {
      expect(localeNativeName(code)).toBe(nativeName)
    }
  })

  it('falls back to the raw code for an unknown one', () => {
    expect(localeNativeName('fr')).toBe('fr')
    expect(localeNativeName('')).toBe('')
  })
})

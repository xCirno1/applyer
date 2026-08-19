// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  THEME_STORAGE_KEY,
  CUSTOM_CSS_STYLE_ID,
  MAX_CUSTOM_CSS_LENGTH,
  DEFAULT_THEME_STATE,
  isValidHexColor,
  parseThemeState,
  readStoredThemeState,
  writeStoredThemeState,
  resolveScheme,
  contrastingForeground,
  applyThemeToDocument
} from './theme'

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('style')
  document.getElementById(CUSTOM_CSS_STYLE_ID)?.remove()
})

describe('isValidHexColor', () => {
  it('accepts 6-digit hex with or without case', () => {
    expect(isValidHexColor('#3c83f6')).toBe(true)
    expect(isValidHexColor('#3C83F6')).toBe(true)
  })

  it('rejects short hex, missing #, and non-hex chars', () => {
    expect(isValidHexColor('#fff')).toBe(false)
    expect(isValidHexColor('3c83f6')).toBe(false)
    expect(isValidHexColor('#gggggg')).toBe(false)
  })
})

describe('parseThemeState', () => {
  it('returns defaults for non-object input', () => {
    expect(parseThemeState(null)).toEqual(DEFAULT_THEME_STATE)
    expect(parseThemeState([1, 2])).toEqual(DEFAULT_THEME_STATE)
  })

  it('accepts valid fields', () => {
    const result = parseThemeState({ mode: 'dark', accent: '#3C83F6', customCss: 'body { color: red; }' })
    expect(result.mode).toBe('dark')
    expect(result.accent).toBe('#3c83f6') // lowercased
    expect(result.customCss).toBe('body { color: red; }')
  })

  it('falls back field-by-field on invalid data rather than discarding the whole state', () => {
    const result = parseThemeState({ mode: 'not-a-mode', accent: 'not-a-color', customCss: 123 })
    expect(result).toEqual(DEFAULT_THEME_STATE)
  })

  it('truncates oversized customCss instead of trusting it wholesale', () => {
    const huge = 'a'.repeat(MAX_CUSTOM_CSS_LENGTH + 500)
    const result = parseThemeState({ customCss: huge })
    expect(result.customCss.length).toBe(MAX_CUSTOM_CSS_LENGTH)
  })
})

describe('readStoredThemeState / writeStoredThemeState', () => {
  it('round-trips through localStorage', () => {
    writeStoredThemeState({ mode: 'dark', accent: '#3c83f6', customCss: '' })
    expect(readStoredThemeState()).toEqual({ mode: 'dark', accent: '#3c83f6', customCss: '' })
  })

  it('returns defaults when nothing is stored or JSON is malformed', () => {
    expect(readStoredThemeState()).toEqual(DEFAULT_THEME_STATE)
    window.localStorage.setItem(THEME_STORAGE_KEY, 'not json')
    expect(readStoredThemeState()).toEqual(DEFAULT_THEME_STATE)
  })
})

describe('resolveScheme', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns light/dark directly for explicit modes', () => {
    expect(resolveScheme('light')).toBe('light')
    expect(resolveScheme('dark')).toBe('dark')
  })

  it('resolves "system" via prefers-color-scheme', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('dark') }))
    expect(resolveScheme('system')).toBe('dark')
  })
})

describe('contrastingForeground', () => {
  it('picks dark text on a light/bright accent', () => {
    expect(contrastingForeground('#ffffff')).toBe('#0b0d11')
    expect(contrastingForeground('#ffff00')).toBe('#0b0d11')
  })

  it('picks white text on a dark accent', () => {
    expect(contrastingForeground('#000000')).toBe('#ffffff')
    expect(contrastingForeground('#1a1a2e')).toBe('#ffffff')
  })
})

describe('applyThemeToDocument', () => {
  it('sets the resolved theme as a data attribute on <html>', () => {
    applyThemeToDocument(DEFAULT_THEME_STATE, 'dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('sets accent custom properties when a valid accent is set', () => {
    applyThemeToDocument({ mode: 'light', accent: '#3c83f6', customCss: '' }, 'light')
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('#3c83f6')
    expect(document.documentElement.style.getPropertyValue('--color-accent-fg')).toBeTruthy()
  })

  it('removes accent custom properties when accent is null', () => {
    applyThemeToDocument({ mode: 'light', accent: '#3c83f6', customCss: '' }, 'light')
    applyThemeToDocument({ mode: 'light', accent: null, customCss: '' }, 'light')
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('')
  })

  it('injects custom CSS into a managed <style> tag and reuses it on re-apply', () => {
    applyThemeToDocument({ mode: 'light', accent: null, customCss: 'body { color: red; }' }, 'light')
    const tag = document.getElementById(CUSTOM_CSS_STYLE_ID)
    expect(tag?.textContent).toBe('body { color: red; }')

    applyThemeToDocument({ mode: 'light', accent: null, customCss: 'body { color: blue; }' }, 'light')
    expect(document.querySelectorAll(`#${CUSTOM_CSS_STYLE_ID}`)).toHaveLength(1)
    expect(document.getElementById(CUSTOM_CSS_STYLE_ID)?.textContent).toBe('body { color: blue; }')
  })

  it('removes the managed <style> tag when customCss becomes empty', () => {
    applyThemeToDocument({ mode: 'light', accent: null, customCss: 'body { color: red; }' }, 'light')
    applyThemeToDocument({ mode: 'light', accent: null, customCss: '' }, 'light')
    expect(document.getElementById(CUSTOM_CSS_STYLE_ID)).toBeNull()
  })
})

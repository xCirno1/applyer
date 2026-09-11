// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  THEME_STORAGE_KEY,
  CUSTOM_CSS_STYLE_ID,
  MAX_CUSTOM_CSS_LENGTH,
  MAX_CSS_PRESETS,
  MAX_PRESET_NAME_LENGTH,
  DEFAULT_THEME_STATE,
  isValidHexColor,
  isValidCanvasTint,
  parseThemeState,
  readStoredThemeState,
  writeStoredThemeState,
  resolveScheme,
  contrastingForeground,
  applyThemeToDocument,
  type ThemeState
} from './theme'

/** Fills in the fields a given test doesn't care about, so each test only spells out what it's asserting on. */
function themeState(overrides: Partial<ThemeState> = {}): ThemeState {
  return { ...DEFAULT_THEME_STATE, ...overrides }
}

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

describe('isValidCanvasTint', () => {
  it('accepts integers in [0, 359]', () => {
    expect(isValidCanvasTint(0)).toBe(true)
    expect(isValidCanvasTint(220)).toBe(true)
    expect(isValidCanvasTint(359)).toBe(true)
  })

  it('rejects out-of-range and non-integer values', () => {
    expect(isValidCanvasTint(-1)).toBe(false)
    expect(isValidCanvasTint(360)).toBe(false)
    expect(isValidCanvasTint(180.5)).toBe(false)
  })
})

describe('parseThemeState', () => {
  it('returns defaults for non-object input', () => {
    expect(parseThemeState(null)).toEqual(DEFAULT_THEME_STATE)
    expect(parseThemeState([1, 2])).toEqual(DEFAULT_THEME_STATE)
  })

  it('accepts valid fields', () => {
    const result = parseThemeState({
      mode: 'dark',
      accent: '#3C83F6',
      canvasTint: 40,
      customCss: 'body { color: red; }'
    })
    expect(result.mode).toBe('dark')
    expect(result.accent).toBe('#3c83f6') // lowercased
    expect(result.canvasTint).toBe(40)
    expect(result.customCss).toBe('body { color: red; }')
  })

  it('falls back field-by-field on invalid data rather than discarding the whole state', () => {
    const result = parseThemeState({
      mode: 'not-a-mode',
      accent: 'not-a-color',
      canvasTint: 720,
      customCss: 123
    })
    expect(result).toEqual(DEFAULT_THEME_STATE)
  })

  it('truncates oversized customCss instead of trusting it wholesale', () => {
    const huge = 'a'.repeat(MAX_CUSTOM_CSS_LENGTH + 500)
    const result = parseThemeState({ customCss: huge })
    expect(result.customCss.length).toBe(MAX_CUSTOM_CSS_LENGTH)
  })

  it('accepts a valid presets array and activePresetId', () => {
    const result = parseThemeState({
      presets: [{ id: 'a', name: 'Compact', css: 'body {}' }],
      activePresetId: 'a'
    })
    expect(result.presets).toEqual([{ id: 'a', name: 'Compact', css: 'body {}' }])
    expect(result.activePresetId).toBe('a')
  })

  it('drops malformed preset entries individually instead of discarding the whole array', () => {
    const result = parseThemeState({
      presets: [
        { id: 'a', name: 'Good', css: 'body {}' },
        { id: 'b', name: '', css: 'body {}' }, // blank name
        { id: 'c', css: 'body {}' }, // missing name
        'not-an-object',
        { id: 'a', name: 'Duplicate id', css: 'body {}' } // duplicate id
      ]
    })
    expect(result.presets).toEqual([{ id: 'a', name: 'Good', css: 'body {}' }])
  })

  it('caps the presets array at MAX_CSS_PRESETS', () => {
    const presets = Array.from({ length: MAX_CSS_PRESETS + 5 }, (_, i) => ({
      id: `p${i}`,
      name: `Preset ${i}`,
      css: ''
    }))
    const result = parseThemeState({ presets })
    expect(result.presets).toHaveLength(MAX_CSS_PRESETS)
  })

  it('truncates an oversized preset name and preset css', () => {
    const longName = 'a'.repeat(MAX_PRESET_NAME_LENGTH + 50)
    const longCss = 'b'.repeat(MAX_CUSTOM_CSS_LENGTH + 50)
    const result = parseThemeState({ presets: [{ id: 'a', name: longName, css: longCss }] })
    expect(result.presets).toHaveLength(1)
    expect(result.presets[0]?.name).toHaveLength(MAX_PRESET_NAME_LENGTH)
    expect(result.presets[0]?.css).toHaveLength(MAX_CUSTOM_CSS_LENGTH)
  })

  it('clears activePresetId when it does not reference a surviving preset', () => {
    const result = parseThemeState({
      presets: [{ id: 'a', name: 'Compact', css: '' }],
      activePresetId: 'does-not-exist'
    })
    expect(result.activePresetId).toBeNull()
  })
})

describe('readStoredThemeState / writeStoredThemeState', () => {
  it('round-trips through localStorage', () => {
    const state = themeState({ mode: 'dark', accent: '#3c83f6' })
    writeStoredThemeState(state)
    expect(readStoredThemeState()).toEqual(state)
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
    applyThemeToDocument(themeState({ accent: '#3c83f6' }), 'light')
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('#3c83f6')
    expect(document.documentElement.style.getPropertyValue('--color-accent-fg')).toBeTruthy()
  })

  it('removes accent custom properties when accent is null', () => {
    applyThemeToDocument(themeState({ accent: '#3c83f6' }), 'light')
    applyThemeToDocument(themeState({ accent: null }), 'light')
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('')
  })

  it('sets canvas ramp custom properties, keeping s/l but swapping in the chosen hue', () => {
    applyThemeToDocument(themeState({ canvasTint: 40 }), 'dark')
    expect(document.documentElement.style.getPropertyValue('--color-canvas')).toBe('hsl(40 13% 13%)')
    expect(document.documentElement.style.getPropertyValue('--color-border')).toBe('hsl(40 10% 27%)')
  })

  it('removes canvas ramp custom properties when canvasTint is null', () => {
    applyThemeToDocument(themeState({ canvasTint: 40 }), 'dark')
    applyThemeToDocument(themeState({ canvasTint: null }), 'dark')
    expect(document.documentElement.style.getPropertyValue('--color-canvas')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--color-border')).toBe('')
  })

  it('injects custom CSS into a managed <style> tag and reuses it on re-apply', () => {
    applyThemeToDocument(themeState({ customCss: 'body { color: red; }' }), 'light')
    const tag = document.getElementById(CUSTOM_CSS_STYLE_ID)
    expect(tag?.textContent).toBe('body { color: red; }')

    applyThemeToDocument(themeState({ customCss: 'body { color: blue; }' }), 'light')
    expect(document.querySelectorAll(`#${CUSTOM_CSS_STYLE_ID}`)).toHaveLength(1)
    expect(document.getElementById(CUSTOM_CSS_STYLE_ID)?.textContent).toBe('body { color: blue; }')
  })

  it('removes the managed <style> tag when customCss becomes empty', () => {
    applyThemeToDocument(themeState({ customCss: 'body { color: red; }' }), 'light')
    applyThemeToDocument(themeState({ customCss: '' }), 'light')
    expect(document.getElementById(CUSTOM_CSS_STYLE_ID)).toBeNull()
  })
})

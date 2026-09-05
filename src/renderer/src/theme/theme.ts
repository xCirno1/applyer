// Theme preference: color scheme (light/dark/system), an optional accent
// color override, canvas tint, and optional raw custom CSS (with named
// presets). Like workspaceLayout.ts, this is a per-browser UI preference
// rather than app state, so it lives in localStorage and has no React/IPC
// dependency — the clamping/parsing rules are what's worth getting right,
// and they don't need a DOM to exercise.
//
// The shape, its bounds, and the two format-validators are declared in
// shared/types/theme.ts instead of here, since the main process needs the
// exact same numbers to validate an imported bundle's `theme` domain (see
// dataTransfer/importSchema.ts) without duplicating them and risking drift.
// Re-exported below so every existing import from this module keeps working.

import {
  DEFAULT_THEME_STATE,
  isValidCanvasTint,
  isValidHexColor,
  MAX_CSS_PRESETS,
  MAX_CUSTOM_CSS_LENGTH,
  MAX_PRESET_NAME_LENGTH,
  type CssPreset,
  type ThemeMode,
  type ThemeState
} from '@shared/types/theme'

export { DEFAULT_THEME_STATE, isValidCanvasTint, isValidHexColor, MAX_CSS_PRESETS, MAX_CUSTOM_CSS_LENGTH, MAX_PRESET_NAME_LENGTH }
export type { CssPreset, ThemeMode, ThemeState }

export type ResolvedScheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'applyer:theme:v1'
export const CUSTOM_CSS_STYLE_ID = 'applyer-custom-css'

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark'
}

/**
 * Validates one stored preset entry rather than the whole array, so one
 * malformed row (a bad import, a manual localStorage edit) drops only itself
 * instead of discarding every saved preset.
 */
function parseCssPreset(raw: unknown): CssPreset | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (typeof value.id !== 'string' || !value.id) return null
  if (typeof value.name !== 'string' || typeof value.css !== 'string') return null
  const name = value.name.trim().slice(0, MAX_PRESET_NAME_LENGTH)
  if (!name) return null
  return { id: value.id, name, css: value.css.slice(0, MAX_CUSTOM_CSS_LENGTH) }
}

function parseCssPresets(raw: unknown): CssPreset[] {
  if (!Array.isArray(raw)) return []
  const seenIds = new Set<string>()
  const presets: CssPreset[] = []
  for (const entry of raw) {
    if (presets.length >= MAX_CSS_PRESETS) break
    const preset = parseCssPreset(entry)
    if (!preset || seenIds.has(preset.id)) continue
    seenIds.add(preset.id)
    presets.push(preset)
  }
  return presets
}

/**
 * Rebuild a theme state from whatever was in storage — or, via `importTheme`,
 * from an imported bundle's `theme` domain, which is exactly as untrusted as
 * storage (a hand-edited or foreign-app-produced file). Every field falls
 * back independently, since an invalid accent or an oversized CSS blob would
 * propagate straight into the DOM (never trust received data).
 */
export function parseThemeState(raw: unknown): ThemeState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_THEME_STATE
  const value = raw as Record<string, unknown>

  const mode = isThemeMode(value.mode) ? value.mode : DEFAULT_THEME_STATE.mode
  const accent =
    typeof value.accent === 'string' && isValidHexColor(value.accent) ? value.accent.toLowerCase() : null
  const canvasTint = typeof value.canvasTint === 'number' && isValidCanvasTint(value.canvasTint) ? value.canvasTint : null
  const customCss = typeof value.customCss === 'string' ? value.customCss.slice(0, MAX_CUSTOM_CSS_LENGTH) : ''
  const presets = parseCssPresets(value.presets)
  const activePresetId =
    typeof value.activePresetId === 'string' && presets.some((p) => p.id === value.activePresetId)
      ? value.activePresetId
      : null

  return { mode, accent, canvasTint, customCss, presets, activePresetId }
}

export function readStoredThemeState(): ThemeState {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (!raw) return DEFAULT_THEME_STATE
    return parseThemeState(JSON.parse(raw))
  } catch {
    // Disabled storage, a quota error, or malformed JSON — not worth
    // surfacing a failure for, fall back to the default theme.
    return DEFAULT_THEME_STATE
  }
}

export function writeStoredThemeState(state: ThemeState): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Same reasoning as the read — the theme still applies for this session.
  }
}

export function resolveScheme(mode: ThemeMode): ResolvedScheme {
  if (mode === 'system') {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}

/**
 * WCAG relative luminance of a hex color, used to pick a readable black/white
 * foreground for an arbitrary user-chosen accent (buttons/badges rendered on
 * top of it need to stay legible regardless of what color was picked).
 */
export function contrastingForeground(hex: string): '#0b0d11' | '#ffffff' {
  const channel = (start: number): number => parseInt(hex.slice(start, start + 2), 16) / 255
  const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  const luminance = 0.2126 * linear(channel(1)) + 0.7152 * linear(channel(3)) + 0.0722 * linear(channel(5))
  return luminance > 0.45 ? '#0b0d11' : '#ffffff'
}

/**
 * The canvas/border ramp's built-in saturation and lightness per token, read
 * straight off tokens.css, keyed by resolved scheme. Canvas tint only swaps
 * each token's hue for the user's chosen one and leaves s/l untouched, so
 * the contrast relationships the design leans on (border vs. surface,
 * surface vs. surface) survive regardless of which hue is picked.
 */
const CANVAS_RAMP: Record<ResolvedScheme, Array<{ variable: string; s: number; l: number }>> = {
  dark: [
    { variable: '--color-canvas-inset', s: 14, l: 10 },
    { variable: '--color-canvas', s: 13, l: 13 },
    { variable: '--color-canvas-soft', s: 12, l: 16 },
    { variable: '--color-canvas-raised', s: 11, l: 19 },
    { variable: '--color-border', s: 10, l: 27 },
    { variable: '--color-border-soft', s: 10, l: 22 }
  ],
  light: [
    { variable: '--color-canvas-inset', s: 20, l: 90 },
    { variable: '--color-canvas', s: 22, l: 94 },
    { variable: '--color-canvas-soft', s: 25, l: 97 },
    { variable: '--color-canvas-raised', s: 0, l: 100 },
    { variable: '--color-border', s: 14, l: 75 },
    { variable: '--color-border-soft', s: 14, l: 82 }
  ]
}

/**
 * Push a theme state onto the live document: the resolved light/dark scheme
 * (tokens.css keys its light-theme override off `[data-theme="light"]`),
 * the accent override (if any) as inline custom properties so it wins over
 * the `@theme` defaults without editing tokens.css itself, the canvas tint
 * override (if any) the same way, and custom CSS as a single managed
 * <style> tag.
 */
export function applyThemeToDocument(state: ThemeState, resolvedScheme: ResolvedScheme): void {
  const root = document.documentElement
  root.dataset.theme = resolvedScheme

  if (state.accent && isValidHexColor(state.accent)) {
    root.style.setProperty('--color-accent', state.accent)
    root.style.setProperty('--color-accent-fg', contrastingForeground(state.accent))
  } else {
    root.style.removeProperty('--color-accent')
    root.style.removeProperty('--color-accent-fg')
  }

  const ramp = CANVAS_RAMP[resolvedScheme]
  if (state.canvasTint !== null && isValidCanvasTint(state.canvasTint)) {
    for (const { variable, s, l } of ramp) {
      root.style.setProperty(variable, `hsl(${state.canvasTint} ${s}% ${l}%)`)
    }
  } else {
    for (const { variable } of ramp) {
      root.style.removeProperty(variable)
    }
  }

  const existing = document.getElementById(CUSTOM_CSS_STYLE_ID) as HTMLStyleElement | null
  if (!state.customCss) {
    existing?.remove()
    return
  }
  const styleTag = existing ?? document.createElement('style')
  if (!existing) {
    styleTag.id = CUSTOM_CSS_STYLE_ID
    document.head.appendChild(styleTag)
  }
  styleTag.textContent = state.customCss.slice(0, MAX_CUSTOM_CSS_LENGTH)
}

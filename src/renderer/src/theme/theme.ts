// Theme preference: color scheme (light/dark/system), an optional accent
// color override, and optional raw custom CSS. Like workspaceLayout.ts, this
// is a per-browser UI preference rather than app state, so it lives in
// localStorage and has no React/IPC dependency — the clamping/parsing rules
// are what's worth getting right, and they don't need a DOM to exercise.

export type ThemeMode = 'system' | 'light' | 'dark'
export type ResolvedScheme = 'light' | 'dark'

export interface ThemeState {
  mode: ThemeMode
  /** Hex color like "#3c83f6", or null to use the built-in default accent. */
  accent: string | null
  /** Raw CSS injected as a <style> tag. Empty string means none. */
  customCss: string
}

export const THEME_STORAGE_KEY = 'applyer:theme:v1'
export const CUSTOM_CSS_STYLE_ID = 'applyer-custom-css'
export const MAX_CUSTOM_CSS_LENGTH = 20_000

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i

export const DEFAULT_THEME_STATE: ThemeState = { mode: 'system', accent: null, customCss: '' }

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function isValidHexColor(value: string): boolean {
  return HEX_COLOR_RE.test(value)
}

/**
 * Rebuild a theme state from whatever was in storage. Every field falls back
 * independently — this is user-writable storage, and an invalid accent or an
 * oversized CSS blob would propagate straight into the DOM (never trust
 * received data).
 */
export function parseThemeState(raw: unknown): ThemeState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_THEME_STATE
  const value = raw as Record<string, unknown>

  const mode = isThemeMode(value.mode) ? value.mode : DEFAULT_THEME_STATE.mode
  const accent =
    typeof value.accent === 'string' && isValidHexColor(value.accent) ? value.accent.toLowerCase() : null
  const customCss = typeof value.customCss === 'string' ? value.customCss.slice(0, MAX_CUSTOM_CSS_LENGTH) : ''

  return { mode, accent, customCss }
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
 * Push a theme state onto the live document: the resolved light/dark scheme
 * (tokens.css keys its light-theme override off `[data-theme="light"]`),
 * the accent override (if any) as inline custom properties so it wins over
 * the `@theme` defaults without editing tokens.css itself, and custom CSS as
 * a single managed <style> tag.
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

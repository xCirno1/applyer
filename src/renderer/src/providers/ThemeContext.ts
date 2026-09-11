import { createContext, useContext } from 'react'
import { DEFAULT_THEME_STATE, type ResolvedScheme, type ThemeMode, type ThemeState } from '../theme/theme'

export interface ThemeContextValue {
  state: ThemeState
  /** `state.mode` with "system" already resolved against the OS preference. */
  resolvedScheme: ResolvedScheme
  setMode: (mode: ThemeMode) => void
  setAccent: (hex: string | null) => void
  resetAccent: () => void
  setCanvasTint: (hue: number | null) => void
  resetCanvasTint: () => void
  setCustomCss: (css: string) => void
  resetCustomCss: () => void
  /** Saves the current `customCss` as a brand-new named preset and makes it active. */
  saveNewPreset: (name: string) => void
  /** Overwrites an existing preset's css with the current `customCss`. */
  updatePreset: (id: string) => void
  /** Loads a preset's css into the editor and marks it active. */
  loadPreset: (id: string) => void
  deletePreset: (id: string) => void
  /**
   * Replaces the whole theme state with the `theme` domain of an imported
   * data bundle (Settings > Data > Import). Runs through the same
   * `parseThemeState` defensive parsing as reading from localStorage — the
   * import file is exactly as untrusted, whether it's hand-edited or just
   * produced by a different app version.
   */
  importTheme: (raw: unknown) => void
}

const noop = (): void => {}

export const ThemeContext = createContext<ThemeContextValue>({
  state: DEFAULT_THEME_STATE,
  resolvedScheme: 'dark',
  setMode: noop,
  setAccent: noop,
  resetAccent: noop,
  setCanvasTint: noop,
  resetCanvasTint: noop,
  setCustomCss: noop,
  resetCustomCss: noop,
  saveNewPreset: noop,
  updatePreset: noop,
  loadPreset: noop,
  deletePreset: noop,
  importTheme: noop
})

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}

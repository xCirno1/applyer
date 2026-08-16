import { createContext, useContext } from 'react'
import { DEFAULT_THEME_STATE, type ResolvedScheme, type ThemeMode, type ThemeState } from '../theme/theme'

export interface ThemeContextValue {
  state: ThemeState
  /** `state.mode` with "system" already resolved against the OS preference. */
  resolvedScheme: ResolvedScheme
  setMode: (mode: ThemeMode) => void
  setAccent: (hex: string | null) => void
  setCustomCss: (css: string) => void
  resetCustomCss: () => void
  resetAccent: () => void
}

const noop = (): void => {}

export const ThemeContext = createContext<ThemeContextValue>({
  state: DEFAULT_THEME_STATE,
  resolvedScheme: 'dark',
  setMode: noop,
  setAccent: noop,
  setCustomCss: noop,
  resetCustomCss: noop,
  resetAccent: noop
})

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}

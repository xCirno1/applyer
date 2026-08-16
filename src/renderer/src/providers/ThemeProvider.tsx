import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { ThemeContext } from './ThemeContext'
import {
  applyThemeToDocument,
  readStoredThemeState,
  resolveScheme,
  writeStoredThemeState,
  type ResolvedScheme,
  type ThemeMode,
  type ThemeState
} from '../theme/theme'

/** A color/CSS edit produces one state change per keystroke; debounce the write. */
const PERSIST_DEBOUNCE_MS = 200

/**
 * Escape hatch for the custom-CSS editor: if injected CSS ever makes the UI
 * unusable (hidden buttons, zero-opacity panels, whatever), this combo
 * strips it instantly. It's a raw keydown listener on `window`, so it keeps
 * working no matter what the bad CSS did visually — nothing about it depends
 * on any element still being visible or clickable.
 */
function isResetShortcut(e: KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Backspace'
}

export default function ThemeProvider({ children }: { children: ReactNode }): ReactElement {
  // Electron's renderer has no SSR pass, so reading storage in the
  // initializer carries none of the hydration-mismatch risk a server-rendered
  // app would have — the first paint can already reflect the saved theme (the
  // inline bootstrap script in index.html already applied it before React
  // even mounted, so this just needs to agree with that).
  const [state, setState] = useState<ThemeState>(() => readStoredThemeState())
  const [systemScheme, setSystemScheme] = useState<ResolvedScheme>(() => resolveScheme('system'))

  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  const resolvedScheme: ResolvedScheme = state.mode === 'system' ? systemScheme : state.mode

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent): void => setSystemScheme(e.matches ? 'dark' : 'light')
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  // Applied live on every change — cheap localStorage/DOM writes with no IPC
  // round trip, so there's no need for an explicit Save button (same
  // reasoning as workspaceLayout's instant-apply persistence). A layout
  // effect rather than a plain effect so the very first application (on
  // mount) lands before the browser paints, avoiding a flash of the
  // hardcoded default theme baked into index.html.
  useLayoutEffect(() => {
    applyThemeToDocument(state, resolvedScheme)
  }, [state, resolvedScheme])

  useEffect(() => {
    const timer = setTimeout(() => writeStoredThemeState(state), PERSIST_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [state])

  // Flush whatever the debounce is still holding if the window closes
  // mid-edit.
  useEffect(() => {
    const flush = (): void => writeStoredThemeState(stateRef.current)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      flush()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!isResetShortcut(e)) return
      if (!stateRef.current.customCss) return
      e.preventDefault()
      setState((prev) => ({ ...prev, customCss: '' }))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const setMode = useCallback((mode: ThemeMode) => setState((prev) => ({ ...prev, mode })), [])
  const setAccent = useCallback((accent: string | null) => setState((prev) => ({ ...prev, accent })), [])
  const setCustomCss = useCallback((customCss: string) => setState((prev) => ({ ...prev, customCss })), [])
  const resetCustomCss = useCallback(() => setState((prev) => ({ ...prev, customCss: '' })), [])
  const resetAccent = useCallback(() => setState((prev) => ({ ...prev, accent: null })), [])

  const value = useMemo(
    () => ({ state, resolvedScheme, setMode, setAccent, setCustomCss, resetCustomCss, resetAccent }),
    [state, resolvedScheme, setMode, setAccent, setCustomCss, resetCustomCss, resetAccent]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

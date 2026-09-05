import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { ThemeContext } from './ThemeContext'
import {
  applyThemeToDocument,
  MAX_CSS_PRESETS,
  MAX_PRESET_NAME_LENGTH,
  parseThemeState,
  readStoredThemeState,
  resolveScheme,
  writeStoredThemeState,
  type CssPreset,
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
      setState((prev) => ({ ...prev, customCss: '', activePresetId: null }))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const setMode = useCallback((mode: ThemeMode) => setState((prev) => ({ ...prev, mode })), [])
  const setAccent = useCallback((accent: string | null) => setState((prev) => ({ ...prev, accent })), [])
  const resetAccent = useCallback(() => setState((prev) => ({ ...prev, accent: null })), [])
  const setCanvasTint = useCallback((canvasTint: number | null) => setState((prev) => ({ ...prev, canvasTint })), [])
  const resetCanvasTint = useCallback(() => setState((prev) => ({ ...prev, canvasTint: null })), [])
  const setCustomCss = useCallback((customCss: string) => setState((prev) => ({ ...prev, customCss })), [])
  const resetCustomCss = useCallback(
    () => setState((prev) => ({ ...prev, customCss: '', activePresetId: null })),
    []
  )

  // Presets are named snapshots of `customCss`; each one leaves the editor's
  // live text alone except loadPreset, which is the one action meant to
  // replace it. Enforcing MAX_CSS_PRESETS/MAX_PRESET_NAME_LENGTH here (not
  // just in the UI) keeps a scripted or malformed caller from writing past
  // what parseThemeState will accept back on the next load.
  const saveNewPreset = useCallback((name: string) => {
    const trimmed = name.trim().slice(0, MAX_PRESET_NAME_LENGTH)
    if (!trimmed) return
    setState((prev) => {
      if (prev.presets.length >= MAX_CSS_PRESETS) return prev
      const preset: CssPreset = { id: crypto.randomUUID(), name: trimmed, css: prev.customCss }
      return { ...prev, presets: [...prev.presets, preset], activePresetId: preset.id }
    })
  }, [])

  const updatePreset = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      presets: prev.presets.map((p) => (p.id === id ? { ...p, css: prev.customCss } : p)),
      activePresetId: id
    }))
  }, [])

  const loadPreset = useCallback((id: string) => {
    setState((prev) => {
      const preset = prev.presets.find((p) => p.id === id)
      if (!preset) return prev
      return { ...prev, customCss: preset.css, activePresetId: preset.id }
    })
  }, [])

  const deletePreset = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      presets: prev.presets.filter((p) => p.id !== id),
      activePresetId: prev.activePresetId === id ? null : prev.activePresetId
    }))
  }, [])

  // Settings > Data > Import's "theme" domain: an imported bundle is exactly
  // as untrusted as localStorage, so this runs through the same defensive
  // parsing rather than trusting the file's shape.
  const importTheme = useCallback((raw: unknown) => setState(parseThemeState(raw)), [])

  const value = useMemo(
    () => ({
      state,
      resolvedScheme,
      setMode,
      setAccent,
      resetAccent,
      setCanvasTint,
      resetCanvasTint,
      setCustomCss,
      resetCustomCss,
      saveNewPreset,
      updatePreset,
      loadPreset,
      deletePreset,
      importTheme
    }),
    [
      state,
      resolvedScheme,
      setMode,
      setAccent,
      resetAccent,
      setCanvasTint,
      resetCanvasTint,
      setCustomCss,
      resetCustomCss,
      saveNewPreset,
      updatePreset,
      loadPreset,
      deletePreset,
      importTheme
    ]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

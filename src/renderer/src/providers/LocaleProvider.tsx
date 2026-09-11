import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import i18n from '../i18n/config'
import {
  matchSystemLocale,
  readStoredLocale,
  systemLanguages,
  writeStoredLocale,
  type LocaleCode,
  type LocalePreference
} from '../i18n/locale'
import { LocaleContext } from './LocaleContext'

/**
 * Owns the language preference and keeps i18next, `<html lang>`, localStorage,
 * and main-process native notifications in agreement.
 *
 * Same shape as ThemeProvider: the preference itself is a plain localStorage
 * value (i18n/locale.ts), and this only wires it to React. Unlike the theme
 * there's no debounce — the language changes on an explicit dropdown pick,
 * not on every keystroke, so each change is worth one write.
 */
export default function LocaleProvider({ children }: { children: ReactNode }): ReactElement {
  const [preference, setPreferenceState] = useState<LocalePreference>(() => readStoredLocale())

  // Held as state rather than recomputed inline for the same reason
  // ThemeProvider holds `systemScheme`: when the preference is 'system', the
  // OS language is the only thing that changes, and re-setting the
  // preference to the string it already holds would bail out of the render.
  const [systemLocale, setSystemLocale] = useState<LocaleCode>(() =>
    matchSystemLocale(systemLanguages())
  )

  const resolved: LocaleCode = preference === 'system' ? systemLocale : preference

  useEffect(() => {
    const onLanguageChange = (): void => setSystemLocale(matchSystemLocale(systemLanguages()))
    window.addEventListener('languagechange', onLanguageChange)
    return () => window.removeEventListener('languagechange', onLanguageChange)
  }, [])

  useEffect(() => {
    // i18next was initialised with this same resolution in config.ts, so on
    // first mount this is a no-op; it matters on every later change.
    if (i18n.language !== resolved) {
      void i18n.changeLanguage(resolved)
    }
    // Keeps screen readers and Chromium's own hyphenation/spellcheck in the
    // right language. LTR-only for now — see CONTRIBUTING.md before adding
    // an RTL locale, the layout uses physical direction classes.
    document.documentElement.setAttribute('lang', resolved)

    // Native notifications are created by Electron's main process, outside
    // i18next's renderer context. Keep a persisted resolved locale there so
    // both real job events and Settings' test actions use the same language.
    void window.api.settings
      .setNotificationLocale(resolved)
      .then((result) => {
        if (!result.ok) console.error('Could not synchronize notification locale', result.error)
      })
      .catch((error: unknown) => console.error('Could not synchronize notification locale', error))
  }, [resolved])

  const setPreference = useCallback((next: LocalePreference) => {
    setPreferenceState(next)
    writeStoredLocale(next)
  }, [])

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference]
  )

  return (
    <I18nextProvider i18n={i18n}>
      <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
    </I18nextProvider>
  )
}

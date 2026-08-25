import { createContext, useContext } from 'react'
import type { LocaleCode, LocalePreference } from '../i18n/locale'

export interface LocaleContextValue {
  /** What the user picked — 'system' stays 'system' here, unresolved. */
  preference: LocalePreference
  /** What that resolved to, and what i18next is actually rendering. */
  resolved: LocaleCode
  setPreference: (preference: LocalePreference) => void
}

export const LocaleContext = createContext<LocaleContextValue | null>(null)

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext)
  if (!value) throw new Error('useLocale must be used inside a LocaleProvider')
  return value
}

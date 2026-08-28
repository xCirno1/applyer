// Language preference: which locale the UI renders in. Exactly the same
// shape as theme.ts — a per-install UI preference with no IPC or React
// dependency, so it lives in localStorage and the parsing/resolution rules
// can be exercised without a DOM.
//
// i18next itself is initialised in config.ts; this module deliberately knows
// nothing about it, so the "what did the user pick / what does that resolve
// to" rules stay testable in isolation from the i18next runtime.

export const SUPPORTED_LOCALES = [
  { code: 'en', englishName: 'English', nativeName: 'English' },
  { code: 'id', englishName: 'Indonesian', nativeName: 'Bahasa Indonesia' }
] as const

export type LocaleCode = (typeof SUPPORTED_LOCALES)[number]['code']

/** What the user picked. 'system' defers to the OS/browser language list. */
export type LocalePreference = 'system' | LocaleCode

export const FALLBACK_LOCALE: LocaleCode = 'en'
export const LOCALE_STORAGE_KEY = 'applyer:locale:v1'

const SUPPORTED_CODES: readonly string[] = SUPPORTED_LOCALES.map((l) => l.code)

export function isLocaleCode(value: unknown): value is LocaleCode {
  return typeof value === 'string' && SUPPORTED_CODES.includes(value)
}

export function isLocalePreference(value: unknown): value is LocalePreference {
  return value === 'system' || isLocaleCode(value)
}

/**
 * Rebuild a preference from whatever was in storage. Same reasoning as
 * parseThemeState: this is user-writable storage, and an unknown code handed
 * to i18next would silently render every key as its raw id.
 */
export function parseLocalePreference(raw: unknown): LocalePreference {
  return isLocalePreference(raw) ? raw : 'system'
}

export function readStoredLocale(): LocalePreference {
  try {
    return parseLocalePreference(window.localStorage.getItem(LOCALE_STORAGE_KEY))
  } catch {
    // Disabled storage or a quota error — not worth surfacing a failure for,
    // fall back to following the system language.
    return 'system'
  }
}

export function writeStoredLocale(preference: LocalePreference): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, preference)
  } catch {
    // Same reasoning as the read — the choice still applies for this session.
  }
}

/**
 * Pick the best supported locale for a browser/OS language list.
 *
 * Matches on the base subtag, so 'id-ID' and 'en-GB' resolve to 'id' and
 * 'en' rather than falling through to the default — the regional variants
 * are what `navigator.languages` actually reports on most systems.
 */
export function matchSystemLocale(languages: readonly string[] | undefined): LocaleCode {
  for (const tag of languages ?? []) {
    if (typeof tag !== 'string') continue
    const base = tag.toLowerCase().split('-')[0]
    if (isLocaleCode(base)) return base
  }
  return FALLBACK_LOCALE
}

/** The locale actually handed to i18next, given a preference. */
export function resolveLocale(
  preference: LocalePreference,
  languages: readonly string[] | undefined
): LocaleCode {
  return preference === 'system' ? matchSystemLocale(languages) : preference
}

/** `navigator.languages`, defensively — jsdom and older runtimes may not have it. */
export function systemLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return []
  return navigator.languages ?? (navigator.language ? [navigator.language] : [])
}

/**
 * A locale's name in its own script ("Bahasa Indonesia", not "Indonesian"),
 * falling back to the raw code so an unrecognised one still renders as
 * something rather than an empty option.
 */
export function localeNativeName(code: string): string {
  return SUPPORTED_LOCALES.find((l) => l.code === code)?.nativeName ?? code
}

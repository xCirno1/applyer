// Structural checks over the translation catalogs.
//
// English is the source of truth and is type-checked at every `t()` call
// site, so what needs guarding here is everything TypeScript can't see: that
// other locales don't drift, that interpolation placeholders survive
// translation, and that plural forms match what each language actually
// needs. A contributor adding a locale should be able to run `npm test` and
// find out what they missed.
import { describe, it, expect } from 'vitest'
import { resources, defaultNS } from './config'
import { SUPPORTED_LOCALES, FALLBACK_LOCALE, type LocaleCode } from './locale'

type Json = { [key: string]: string | Json }

/** Flatten to dotted paths, dropping i18next's plural suffixes. */
function flatten(obj: Json, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') out.set(path, value)
    else for (const [k, v] of flatten(value, path)) out.set(k, v)
  }
  return out
}

/** `confirm.retryMessage_one` -> `confirm.retryMessage`. */
function stripPluralSuffix(path: string): string {
  return path.replace(/_(zero|one|two|few|many|other)$/, '')
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]!).sort()
}

const NAMESPACES = Object.keys(resources[FALLBACK_LOCALE]) as (keyof (typeof resources)['en'])[]
const OTHER_LOCALES = SUPPORTED_LOCALES.map((l) => l.code).filter(
  (code): code is LocaleCode => code !== FALLBACK_LOCALE
)

describe('catalog structure', () => {
  it('exposes the same namespaces for every locale', () => {
    for (const { code } of SUPPORTED_LOCALES) {
      expect(Object.keys(resources[code]).sort()).toEqual(Object.keys(resources[FALLBACK_LOCALE]).sort())
    }
  })

  it('uses a defaultNS that actually exists', () => {
    expect(NAMESPACES).toContain(defaultNS)
  })

  it('has no empty strings in the English catalog', () => {
    for (const ns of NAMESPACES) {
      for (const [path, value] of flatten(resources[FALLBACK_LOCALE][ns] as Json)) {
        expect(value.trim(), `${ns}:${path} is empty`).not.toBe('')
      }
    }
  })
})

describe.each(OTHER_LOCALES)('%s catalog', (locale) => {
  it('has no keys that English does not', () => {
    // The reverse (missing keys) is deliberately allowed — i18next falls back
    // to English, so a partial translation is a working translation. An
    // *extra* key is always a mistake: a typo, or a leftover after an
    // English key was renamed.
    for (const ns of NAMESPACES) {
      const english = new Set([...flatten(resources[FALLBACK_LOCALE][ns] as Json).keys()].map(stripPluralSuffix))
      for (const path of flatten(resources[locale][ns] as Json).keys()) {
        expect(english.has(stripPluralSuffix(path)), `${locale} has unknown key ${ns}:${path}`).toBe(true)
      }
    }
  })

  it('keeps the same interpolation placeholders as English', () => {
    // A dropped {{count}} renders a sentence with a hole in it, and a typo'd
    // one renders the literal braces — neither is visible to TypeScript.
    for (const ns of NAMESPACES) {
      const english = flatten(resources[FALLBACK_LOCALE][ns] as Json)
      for (const [path, translated] of flatten(resources[locale][ns] as Json)) {
        const source = english.get(path) ?? english.get(`${stripPluralSuffix(path)}_other`)
        if (source === undefined) continue // covered by the unknown-key test
        expect(placeholders(translated), `${locale} ${ns}:${path}`).toEqual(placeholders(source))
      }
    }
  })

  it('provides every plural form its language requires', () => {
    const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories
    for (const ns of NAMESPACES) {
      const paths = [...flatten(resources[locale][ns] as Json).keys()]
      const pluralBases = new Set(
        paths.filter((p) => p !== stripPluralSuffix(p)).map(stripPluralSuffix)
      )
      for (const base of pluralBases) {
        for (const category of categories) {
          expect(paths, `${locale} ${ns}:${base} missing _${category}`).toContain(`${base}_${category}`)
        }
      }

      // ...and no forms the language never selects. These are silently dead
      // at runtime, so nothing else would ever surface them — but a
      // translator copying the English `_one`/`_other` pair into a language
      // with only `other` has written a string no user will ever see.
      for (const path of paths) {
        const base = stripPluralSuffix(path)
        if (base === path) continue
        const category = path.slice(base.length + 1)
        expect(categories, `${locale} ${ns}:${path} is never selected in ${locale}`).toContain(category)
      }
    }
  })
})

// Locale-aware date/number formatting.
//
// These replace bare `toLocaleString()` calls, which read the *browser's*
// locale and so would keep formatting dates in the OS language after the
// user picks a different one in Settings. Every helper takes the active
// locale explicitly (see useFormatters) so the two can't drift apart.
//
// Intl.DateTimeFormat construction is not free and these run per row in
// paginated lists, so formatters are memoised per locale+kind.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { LocaleCode } from './locale'

type FormatterKind = 'date' | 'time' | 'dateTime'

const OPTIONS: Record<FormatterKind, Intl.DateTimeFormatOptions> = {
  date: { dateStyle: 'medium' },
  time: { timeStyle: 'medium' },
  dateTime: { dateStyle: 'medium', timeStyle: 'short' }
}

const dateCache = new Map<string, Intl.DateTimeFormat>()
const numberCache = new Map<string, Intl.NumberFormat>()

function dateFormatter(locale: string, kind: FormatterKind): Intl.DateTimeFormat {
  const key = `${locale}:${kind}`
  let formatter = dateCache.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, OPTIONS[kind])
    dateCache.set(key, formatter)
  }
  return formatter
}

function numberFormatter(locale: string): Intl.NumberFormat {
  let formatter = numberCache.get(locale)
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale)
    numberCache.set(locale, formatter)
  }
  return formatter
}

/**
 * Format an ISO timestamp, falling back to the raw string when it isn't a
 * real date — these come from the database and from imported bundles, so an
 * unparseable value has to render as itself rather than "Invalid Date".
 */
export function formatIsoDate(iso: string, locale: string, kind: FormatterKind): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : dateFormatter(locale, kind).format(date)
}

export function formatNumber(value: number, locale: string): string {
  return Number.isFinite(value) ? numberFormatter(locale).format(value) : String(value)
}

export interface Formatters {
  /** "12 Mar 2026" */
  date: (iso: string) => string
  /** "14:07:33" */
  time: (iso: string) => string
  /** "12 Mar 2026, 14:07" */
  dateTime: (iso: string) => string
  number: (value: number) => string
}

/** The formatters bound to whichever locale i18next is currently using. */
export function useFormatters(): Formatters {
  const { i18n } = useTranslation()
  const locale = i18n.language as LocaleCode

  return useMemo(
    () => ({
      date: (iso: string) => formatIsoDate(iso, locale, 'date'),
      time: (iso: string) => formatIsoDate(iso, locale, 'time'),
      dateTime: (iso: string) => formatIsoDate(iso, locale, 'dateTime'),
      number: (value: number) => formatNumber(value, locale)
    }),
    [locale]
  )
}

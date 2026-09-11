import { htmlToPlainText } from '../../htmlContent'

/**
 * Narrowing helpers for board payloads.
 *
 * Nothing here is our data: it's whatever a third-party API sent back today,
 * and every field the reference measurements call "always present" is still
 * one product change away from being absent. So every read goes through one
 * of these and a row that doesn't survive is skipped and counted, never
 * turned into a posting with `undefined` in a required field.
 */

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function asString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  // Ids in particular arrive as numbers on Greenhouse and as strings elsewhere.
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

export function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** Earliest/latest timestamps we'll believe — anything outside is a parsing accident, not a posting date. */
const MIN_PLAUSIBLE_MS = Date.UTC(1990, 0, 1)
const MAX_FUTURE_SKEW_MS = 365 * 24 * 60 * 60 * 1000

/**
 * Boards publish dates as ISO strings (Greenhouse, Ashby) or epoch
 * milliseconds (Lever), and some publish nothing at all. An unparseable or
 * implausible value becomes `undefined` rather than an `Invalid Date`
 * string, since a wrong date sorts wrongly and is worse than no date.
 */
export function toIsoTimestamp(value: unknown): string | undefined {
  let ms: number | undefined
  if (typeof value === 'number' && Number.isFinite(value)) {
    ms = value
  } else if (typeof value === 'string' && value.trim()) {
    const asNumber = Number(value.trim())
    ms = Number.isFinite(asNumber) && /^\d+$/.test(value.trim()) ? asNumber : Date.parse(value)
  }

  if (ms === undefined || !Number.isFinite(ms)) return undefined
  if (ms < MIN_PLAUSIBLE_MS || ms > Date.now() + MAX_FUTURE_SKEW_MS) return undefined
  return new Date(ms).toISOString()
}

export const SNIPPET_MAX_CHARS = 240

/** Board descriptions run to thousands of words; a search result only needs the first breath of one. */
export function toSnippet(text: string | undefined, isHtml = false): string {
  if (!text) return ''
  const plain = (isHtml ? htmlToPlainText(text) : text).replace(/\s+/g, ' ').trim()
  if (plain.length <= SNIPPET_MAX_CHARS) return plain
  return `${plain.slice(0, SNIPPET_MAX_CHARS - 1).trimEnd()}…`
}

/**
 * Keeps a posting URL only if it is an http(s) URL — the alternative is
 * storing whatever string the board sent as a job's `url`, which is the one
 * field the rest of the app treats as an identity and opens in a browser.
 */
export function safeHttpUrl(value: unknown): string | undefined {
  const raw = asString(value)
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

const CURRENCY_SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' }

function formatAmount(amount: number, currency: string | undefined): string {
  // Deliberately not `Intl.NumberFormat` with a locale: the main process has
  // no locale (see shared/types/errorCodes.ts), and this string is stored and
  // shown as-is, so it has to be stable rather than machine-dependent.
  const rounded = Math.round(amount)
  const grouped = rounded.toLocaleString('en-US')
  const symbol = currency ? CURRENCY_SYMBOLS[currency.toUpperCase()] : undefined
  if (symbol) return `${symbol}${grouped}`
  return currency ? `${grouped} ${currency.toUpperCase()}` : grouped
}

/**
 * Renders a declared range without interpreting it.
 *
 * `periodLabel` is free text the employer typed (Greenhouse) or a code they
 * picked from a list (Lever), and both are known to be wrong sometimes — one
 * live Lever posting labels an hourly rate `bi-week-salary`. It's carried
 * through so the number stays comparable, and never used to rescale.
 */
export function formatSalaryRange(
  min: number | undefined,
  max: number | undefined,
  currency: string | undefined,
  periodLabel?: string
): string | undefined {
  // A company can switch the field on and leave it at zero. That is "not
  // declared", not a job paying nothing.
  const lo = min !== undefined && min > 0 ? min : undefined
  const hi = max !== undefined && max > 0 ? max : undefined
  if (lo === undefined && hi === undefined) return undefined

  const label = periodLabel?.trim().replace(/[:\s]+$/, '')
  const amounts =
    lo !== undefined && hi !== undefined && hi !== lo
      ? `${formatAmount(lo, currency)} – ${formatAmount(hi, currency)}`
      : formatAmount((lo ?? hi)!, currency)

  return label ? `${amounts} (${label})` : amounts
}

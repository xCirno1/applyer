/**
 * "3d ago" into a date.
 *
 * Search result cards on Seek and Jora print how long ago a job was listed
 * rather than when, and that relative phrase is all the card has. The
 * detail page carries the real date in its JSON-LD, so this only exists to
 * give the agent something to sort and filter by before it has fetched
 * details. It returns a day-resolution ISO date in the calendar of the
 * zone given (the searched edition's, see `SEARCH_COUNTRY_TIME_ZONES`),
 * since "Today" on a Sydney card means Sydney's today whatever the clock of
 * the machine running this says; anything it doesn't recognise is null
 * rather than a guess.
 */

const UNIT_MS: Record<string, number> = {
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
  w: 604_800_000,
  wk: 604_800_000,
  week: 604_800_000,
  weeks: 604_800_000,
  mo: 2_592_000_000,
  month: 2_592_000_000,
  months: 2_592_000_000
}

const formatterByZone = new Map<string, Intl.DateTimeFormat | null>()

/**
 * The calendar date of an instant in a zone, as YYYY-MM-DD. `en-CA` is the
 * locale whose short date is already that shape. A zone name the runtime
 * does not know (the table is hand-written, and ICU data varies) falls back
 * to UTC rather than throwing on every card.
 */
export function calendarDate(instant: Date, timeZone: string): string {
  let formatter = formatterByZone.get(timeZone)
  if (formatter === undefined) {
    try {
      formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    } catch {
      formatter = null
    }
    formatterByZone.set(timeZone, formatter)
  }
  if (!formatter) return instant.toISOString().slice(0, 10)
  const parts = formatter.formatToParts(instant)
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? ''
  const year = part('year')
  const month = part('month')
  const day = part('day')
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) return instant.toISOString().slice(0, 10)
  return `${year}-${month}-${day}`
}

export function relativeListingDate(
  text: string | null | undefined,
  now: Date = new Date(),
  timeZone: string = 'UTC'
): string | null {
  if (!text) return null
  const normalized = text.trim().toLowerCase()
  if (normalized.length === 0) return null

  if (/^(today|just now|just posted|new)$/.test(normalized) || /\b(today|just now|just posted)\b/.test(normalized)) {
    return calendarDate(now, timeZone)
  }
  if (/\byesterday\b/.test(normalized)) {
    return calendarDate(new Date(now.getTime() - UNIT_MS.d!), timeZone)
  }
  if (/^(30\+|\d+\+)\s*(d|days?)\b/.test(normalized)) {
    const days = Number.parseInt(normalized, 10)
    if (Number.isFinite(days)) return calendarDate(new Date(now.getTime() - days * UNIT_MS.d!), timeZone)
  }

  const match = normalized.match(/(\d+)\s*([a-z]+)/)
  if (!match) return null
  const amount = Number.parseInt(match[1]!, 10)
  const unit = UNIT_MS[match[2]!]
  if (!Number.isFinite(amount) || unit === undefined) return null
  return calendarDate(new Date(now.getTime() - amount * unit), timeZone)
}

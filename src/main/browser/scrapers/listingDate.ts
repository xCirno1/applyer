/**
 * "3d ago" into a date.
 *
 * Search result cards on Seek and Jora print how long ago a job was listed
 * rather than when, and that relative phrase is all the card has. The
 * detail page carries the real date in its JSON-LD, so this only exists to
 * give the agent something to sort and filter by before it has fetched
 * details. It returns a day-resolution ISO date; anything it doesn't
 * recognise is null rather than a guess.
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

export function relativeListingDate(text: string | null | undefined, now: Date = new Date()): string | null {
  if (!text) return null
  const normalized = text.trim().toLowerCase()
  if (normalized.length === 0) return null

  if (/^(today|just now|just posted|new)$/.test(normalized) || /\b(today|just now|just posted)\b/.test(normalized)) {
    return now.toISOString().slice(0, 10)
  }
  if (/\byesterday\b/.test(normalized)) {
    return new Date(now.getTime() - UNIT_MS.d!).toISOString().slice(0, 10)
  }
  if (/^(30\+|\d+\+)\s*(d|days?)\b/.test(normalized)) {
    const days = Number.parseInt(normalized, 10)
    if (Number.isFinite(days)) return new Date(now.getTime() - days * UNIT_MS.d!).toISOString().slice(0, 10)
  }

  const match = normalized.match(/(\d+)\s*([a-z]+)/)
  if (!match) return null
  const amount = Number.parseInt(match[1]!, 10)
  const unit = UNIT_MS[match[2]!]
  if (!Number.isFinite(amount) || unit === undefined) return null
  return new Date(now.getTime() - amount * unit).toISOString().slice(0, 10)
}

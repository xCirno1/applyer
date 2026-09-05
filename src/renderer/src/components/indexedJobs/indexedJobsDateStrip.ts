import type { TFunction } from 'i18next'

/**
 * `YYYY-MM-DD` for the UTC calendar day `offsetDays` away from `now`
 * (0 = today, -1 = yesterday). Plain-module half of `IndexedJobsDateStrip`
 * (same split as `workspace/workspaceLayout.ts`), so the day-rollover math
 * is testable without mounting anything.
 */
export function utcDateString(offsetDays = 0, now: Date = new Date()): string {
  const rolled = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays))
  return rolled.toISOString().slice(0, 10)
}

export interface DateStripLabel {
  /** "Today" / "Yesterday" / a short weekday name. */
  primary: string
  /** "Sep 6" */
  secondary: string
}

/**
 * `firstSeenAt` is stored as a UTC ISO string, and `listIndexedJobDates`
 * buckets by its UTC calendar day server-side — so "today"/"yesterday" here
 * are judged against the UTC day too, not the viewer's local one. That can
 * be off by one for a few hours around midnight in timezones far from UTC,
 * an accepted trade for not needing every viewer's timezone in the query.
 */
export function dateStripLabel(
  date: string,
  locale: string,
  t: TFunction<'indexedJobs'>,
  now: Date = new Date()
): DateStripLabel {
  const asUtcMidnight = new Date(`${date}T00:00:00Z`)
  const secondary = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    asUtcMidnight
  )

  if (date === utcDateString(0, now)) return { primary: t('dateStrip.today'), secondary }
  if (date === utcDateString(-1, now)) return { primary: t('dateStrip.yesterday'), secondary }

  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(asUtcMidnight)
  return { primary: weekday, secondary }
}

export interface DateStripDay {
  date: string
  count: number
}

/** Hard cap on how many days a single gap can fill in, so one bad `firstSeenAt` can't render millions of chips. */
const MAX_DATE_STRIP_DAYS = 400

/**
 * Every calendar day from today (or the newest bucket, if that's somehow
 * ahead of today) back through the oldest fetched bucket, zero-filled for
 * days with no indexed jobs. Lets the strip show a continuous run of days
 * with the empty ones visibly disabled, instead of jumping straight from one
 * real bucket to the next and reading like a broken sequence.
 */
export function fillDateStripDays(buckets: readonly DateStripDay[], now: Date = new Date()): DateStripDay[] {
  if (buckets.length === 0) return []

  const counts = new Map(buckets.map((b) => [b.date, b.count]))
  const today = utcDateString(0, now)
  const newest = buckets[0]!.date > today ? buckets[0]!.date : today
  const oldest = buckets[buckets.length - 1]!.date

  const newestMs = Date.parse(`${newest}T00:00:00Z`)
  const oldestMs = Date.parse(`${oldest}T00:00:00Z`)
  if (!Number.isFinite(newestMs) || !Number.isFinite(oldestMs) || oldestMs > newestMs) {
    // A malformed bucket date shouldn't crash the strip; fall back to the real buckets alone.
    return buckets.map((b) => ({ date: b.date, count: b.count }))
  }

  const totalDays = Math.min(MAX_DATE_STRIP_DAYS, Math.round((newestMs - oldestMs) / 86_400_000) + 1)
  const days: DateStripDay[] = []
  for (let i = 0; i < totalDays; i++) {
    const date = utcDateString(-i, new Date(newestMs))
    days.push({ date, count: counts.get(date) ?? 0 })
  }
  return days
}

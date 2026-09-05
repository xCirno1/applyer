import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useIndexedJobsStore } from '../../state/indexedJobsStore'
import Tooltip from '../ui/Tooltip'
import Skeleton from '../ui/Skeleton'
import { dateStripLabel, fillDateStripDays, type DateStripDay } from './indexedJobsDateStrip'

const SCROLL_STEP_PX = 200

function ChevronIcon({ direction }: { direction: 'left' | 'right' }): ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={direction === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function FilterIcon(): ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 5h16l-6.5 7.5V19l-3-1.5v-5L4 5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * A horizontal, scrollable strip above the "Indexed" tab's list, letting it
 * be browsed by when a job was first surfaced (the way
 * `IndexedJobsRetentionControl` bounds it by how long that history is kept).
 * Rectangular buttons rather than pills, per the app's style guidelines. Runs
 * oldest to newest, left to right, like a normal timeline, with today at the
 * right edge; the strip auto-scrolls to that edge on load and whenever the
 * "only indexed days" toggle changes, so today stays the default thing in
 * view rather than requiring a scroll to find it. By default it shows every
 * day back to the oldest fetched bucket, with days that have no indexed jobs
 * rendered disabled rather than skipped, so a gap reads as "nothing happened
 * here" instead of looking like the sequence jumped. The toggle collapses
 * the strip down to just the real buckets, for when the history is dense
 * enough that the fill-in days are more clutter than context. A click
 * toggles that day's filter on `indexedJobsStore.filters.date`, and clicking
 * the selected day again (or "All") clears it.
 */
export default function IndexedJobsDateStrip(): ReactElement | null {
  const { t, i18n } = useTranslation('indexedJobs')
  const dateBuckets = useIndexedJobsStore((s) => s.dateBuckets)
  const dateBucketsLoaded = useIndexedJobsStore((s) => s.dateBucketsLoaded)
  const selectedDate = useIndexedJobsStore((s) => s.filters.date)
  const setFilters = useIndexedJobsStore((s) => s.setFilters)
  const fetchDateBuckets = useIndexedJobsStore((s) => s.fetchDateBuckets)

  const [onlyIndexed, setOnlyIndexed] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  useEffect(() => {
    fetchDateBuckets()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // fillDateStripDays returns newest first; reversed here so the strip reads
  // as a normal timeline (oldest on the left, today on the right) without
  // that ordering leaking into the plain-module's own contract or tests.
  const filledDays = useMemo(() => fillDateStripDays(dateBuckets), [dateBuckets])
  const displayedDays: DateStripDay[] = useMemo(() => {
    const days = onlyIndexed ? filledDays.filter((day) => day.count > 0) : filledDays
    return [...days].reverse()
  }, [filledDays, onlyIndexed])

  const updateScrollState = (): void => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 0)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }

  useEffect(() => {
    updateScrollState()
  }, [displayedDays])

  // Today sits at the right edge now, so land the scroll there by default
  // instead of leaving it at the oldest (leftmost) day.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollLeft = el.scrollWidth
    updateScrollState()
    // Re-run when the toggle changes the day range, not on every data refresh.
  }, [dateBucketsLoaded, onlyIndexed])

  const scrollBy = (delta: number): void => {
    scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' })
  }

  const selectDate = (date: string): void => {
    setFilters({ date: selectedDate === date ? null : date })
  }

  if (!dateBucketsLoaded) {
    return (
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border-soft bg-canvas px-2">
        <Skeleton className="h-8 w-14" />
        <Skeleton className="h-8 w-14" />
        <Skeleton className="h-8 w-14" />
        <Skeleton className="h-8 w-14" />
      </div>
    )
  }

  if (dateBuckets.length === 0) return null

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border-soft bg-canvas px-2">
      <button
        type="button"
        onClick={() => setFilters({ date: null })}
        className={`flex h-8 shrink-0 cursor-pointer items-center border px-2.5 text-[11px] font-medium ${
          selectedDate === null
            ? 'border-accent text-accent'
            : 'border-border text-text-muted hover:border-text-faint hover:text-text'
        }`}
      >
        {t('dateStrip.all')}
      </button>

      <button
        type="button"
        onClick={() => scrollBy(-SCROLL_STEP_PX)}
        disabled={!canScrollLeft}
        aria-label={t('dateStrip.scrollEarlier')}
        className="flex h-8 w-6 shrink-0 cursor-pointer items-center justify-center border border-border text-text-muted hover:text-text disabled:pointer-events-none disabled:opacity-30"
      >
        <ChevronIcon direction="left" />
      </button>

      <div ref={scrollRef} onScroll={updateScrollState} className="flex min-w-0 gap-1 overflow-x-auto">
        {displayedDays.map((day) => {
          const label = dateStripLabel(day.date, i18n.language, t)
          const selected = selectedDate === day.date

          if (day.count === 0) {
            return (
              <span
                key={day.date}
                aria-disabled="true"
                className="flex h-8 w-16 shrink-0 flex-col items-center justify-center gap-0.5 border border-border-soft px-1 opacity-50"
              >
                <span className="truncate text-[11px] font-medium leading-none text-text-faint">{label.primary}</span>
                <span className="truncate text-[10px] leading-none text-text-faint">{label.secondary}</span>
              </span>
            )
          }

          return (
            <Tooltip key={day.date} label={t('dateStrip.count', { count: day.count })}>
              <button
                type="button"
                onClick={() => selectDate(day.date)}
                aria-pressed={selected}
                className={`flex h-8 w-16 shrink-0 flex-col items-center justify-center gap-0.5 border px-1 ${
                  selected
                    ? 'border-accent text-accent'
                    : 'border-border text-text-muted hover:border-text-faint hover:text-text'
                }`}
              >
                <span className="truncate text-[11px] font-medium leading-none">{label.primary}</span>
                <span className={`truncate text-[10px] leading-none ${selected ? 'text-accent' : 'text-text-faint'}`}>
                  {label.secondary}
                </span>
              </button>
            </Tooltip>
          )
        })}
      </div>

      <button
        type="button"
        onClick={() => scrollBy(SCROLL_STEP_PX)}
        disabled={!canScrollRight}
        aria-label={t('dateStrip.scrollLater')}
        className="flex h-8 w-6 shrink-0 cursor-pointer items-center justify-center border border-border text-text-muted hover:text-text disabled:pointer-events-none disabled:opacity-30"
      >
        <ChevronIcon direction="right" />
      </button>

      <Tooltip label={onlyIndexed ? t('dateStrip.showAllDays') : t('dateStrip.showOnlyIndexed')}>
        <button
          type="button"
          onClick={() => setOnlyIndexed((v) => !v)}
          aria-pressed={onlyIndexed}
          aria-label={onlyIndexed ? t('dateStrip.showAllDays') : t('dateStrip.showOnlyIndexed')}
          className={`flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center border ${
            onlyIndexed ? 'border-accent text-accent' : 'border-border text-text-muted hover:border-text-faint hover:text-text'
          }`}
        >
          <FilterIcon />
        </button>
      </Tooltip>
    </div>
  )
}

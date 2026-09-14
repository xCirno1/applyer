import type { ReactElement, ReactNode } from 'react'

export interface MetaItem {
  key: string
  /** The value to show. An item whose value is empty is dropped, not rendered as a gap. */
  value: ReactNode
  /** Absorb the leftover width and truncate, instead of sizing to the content. */
  grow?: boolean
  /** Extra classes for this item alone, e.g. a danger tone for a failure. */
  className?: string
  /** Native hover title, for a value that may be truncated. */
  title?: string
}

/**
 * Every falsy shape a `cond && item` call site can produce is accepted, so a
 * conditional value never has to be padded into a ternary just to satisfy the
 * type: `job.location && {...}` on a nullable string is `'' | null | MetaItem`.
 */
export type MetaEntry = MetaItem | false | null | undefined | '' | 0

interface Props {
  items: MetaEntry[]
  className?: string
  /**
   * Let the run break onto further lines instead of staying on one. Every
   * item still carries a seam on its left; the container is pulled left by
   * the item padding and clips, so a seam that would start a new line falls
   * outside and is never drawn.
   */
  wrap?: boolean
}

/**
 * A run of secondary values on one line (a slug, a count, a date), separated
 * by 1px seams rather than the middle dot this app used to use. A dot sits on
 * the text baseline and reads as a character of the value beside it, which is
 * wrong for values that get scanned rather than read; a seam is the same
 * divider the panels themselves are built from.
 *
 * Falsy items are dropped here rather than at each call site, so a missing
 * value cannot leave a leading or doubled separator behind.
 *
 * Used by JobDetailModal's meta line, ExclusionsPanel rows, PipelineOverview's
 * legend counts, and the document lists in Settings/onboarding.
 */
export default function MetaList({ items, className = '', wrap = false }: Props): ReactElement {
  const visible = items.filter(
    (item): item is MetaItem =>
      typeof item === 'object' && item !== null && item.value !== null && item.value !== undefined && item.value !== ''
  )

  if (wrap) {
    return (
      <div className={`-ml-2 flex min-w-0 flex-wrap items-center gap-y-1 overflow-hidden ${className}`}>
        {visible.map((item) => (
          <span
            key={item.key}
            title={item.title}
            className={['-ml-px border-l border-border-soft pl-2 pr-2', item.className ?? ''].filter(Boolean).join(' ')}
          >
            {item.value}
          </span>
        ))}
      </div>
    )
  }

  return (
    <div className={`flex min-w-0 items-center ${className}`}>
      {visible.map((item, index) => (
        <span
          key={item.key}
          title={item.title}
          className={[
            index > 0 ? 'ml-2 border-l border-border-soft pl-2' : '',
            item.grow ? 'min-w-0 truncate' : 'shrink-0',
            item.className ?? ''
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {item.value}
        </span>
      ))}
    </div>
  )
}

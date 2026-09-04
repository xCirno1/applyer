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
 */
export default function MetaList({ items, className = '' }: Props): ReactElement {
  const visible = items.filter(
    (item): item is MetaItem =>
      typeof item === 'object' && item !== null && item.value !== null && item.value !== undefined && item.value !== ''
  )

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

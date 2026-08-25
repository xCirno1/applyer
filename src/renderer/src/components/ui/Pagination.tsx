import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

type PageItem = number | 'ellipsis-left' | 'ellipsis-right'

/** First, last, current page, and one sibling on each side — collapsing the rest behind an ellipsis once there are too many pages to show flat. */
function getPageItems(page: number, totalPages: number): PageItem[] {
  const siblingCount = 1
  const totalSlots = siblingCount * 2 + 5

  if (totalPages <= totalSlots) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }

  const leftSibling = Math.max(page - siblingCount, 1)
  const rightSibling = Math.min(page + siblingCount, totalPages)
  const showLeftEllipsis = leftSibling > 2
  const showRightEllipsis = rightSibling < totalPages - 1

  const items: PageItem[] = [1]
  if (showLeftEllipsis) items.push('ellipsis-left')
  for (let p = Math.max(leftSibling, 2); p <= Math.min(rightSibling, totalPages - 1); p++) items.push(p)
  if (showRightEllipsis) items.push('ellipsis-right')
  items.push(totalPages)
  return items
}

export interface PaginationProps {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  disabled?: boolean
}

/** Numbered page buttons with prev/next arrows. Renders nothing for a single page — there's nothing to paginate. */
export default function Pagination({ page, totalPages, onPageChange, disabled = false }: PaginationProps): ReactElement | null {
  const { t } = useTranslation()
  if (totalPages <= 1) return null

  return (
    <nav className="flex items-center justify-center gap-1" aria-label={t('pagination.label')}>
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={disabled || page <= 1}
        aria-label={t('pagination.previous')}
        className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center border border-border text-text-muted hover:border-text-faint hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronIcon direction="left" />
      </button>

      {getPageItems(page, totalPages).map((item, i) =>
        typeof item === 'number' ? (
          <button
            key={item}
            type="button"
            onClick={() => onPageChange(item)}
            disabled={disabled}
            aria-current={item === page ? 'page' : undefined}
            className={`h-6 min-w-6 shrink-0 cursor-pointer border px-1.5 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
              item === page
                ? 'border-accent bg-accent text-accent-fg'
                : 'border-border text-text-muted hover:border-text-faint hover:text-text'
            }`}
          >
            {item}
          </button>
        ) : (
          <span key={`${item}-${i}`} className="px-1 text-[12px] text-text-faint">
            …
          </span>
        )
      )}

      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={disabled || page >= totalPages}
        aria-label={t('pagination.next')}
        className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center border border-border text-text-muted hover:border-text-faint hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronIcon direction="right" />
      </button>
    </nav>
  )
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' }): ReactElement {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      className={direction === 'right' ? 'rotate-180' : ''}
    >
      <path d="M7.5 2.5L4 6l3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

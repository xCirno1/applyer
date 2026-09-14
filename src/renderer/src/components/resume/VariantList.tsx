import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ResumeVariantSummary } from '@shared/types/resume'
import Skeleton from '../ui/Skeleton'
import Tag from '../ui/Tag'
import ResumeStatusTag from './ResumeStatusTag'

/*
 * The left column of the Variants tab: one row per named variant, in name
 * order (the order main returns them in), with how many jobs use it. A
 * variant being drafted (not saved yet, see `VariantsTab`) is shown as a
 * row at the top so the list reads as "this is what you are working on".
 * Selection is a left accent seam, the same signal the icon rail and job
 * cards use, so the selected row reads as "this one is open" rather than as
 * a highlighted button.
 */

export const NEW_VARIANT_ROW_ID = 'new'

interface VariantListProps {
  variants: ResumeVariantSummary[]
  /** A variant id, or `NEW_VARIANT_ROW_ID` while a new one is being drafted. */
  selectedId: string | null
  /** The name typed so far for the draft row; `null` when nothing is being drafted. */
  draftName: string | null
  loaded: boolean
  onSelect: (id: string) => void
}

export default function VariantList({ variants, selectedId, draftName, loaded, onSelect }: VariantListProps): ReactElement {
  const { t } = useTranslation('resumes')

  if (!loaded) {
    return (
      <div className="flex flex-col gap-px p-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }

  const rowClass = (selected: boolean): string =>
    `flex w-full cursor-pointer flex-col gap-0.5 border-l-2 px-3 py-1.5 text-left hover:bg-canvas-soft ${
      selected ? 'border-l-accent bg-canvas-soft' : 'border-l-transparent'
    }`

  return (
    <ul className="flex flex-col" aria-label={t('variants.title')}>
      {draftName !== null && (
        <li className="border-b border-border-soft">
          <button
            type="button"
            onClick={() => onSelect(NEW_VARIANT_ROW_ID)}
            aria-current={selectedId === NEW_VARIANT_ROW_ID || undefined}
            className={rowClass(selectedId === NEW_VARIANT_ROW_ID)}
          >
            <span className="flex items-center justify-between gap-2">
              <span className={`min-w-0 truncate text-[13px] font-medium ${draftName ? 'text-text' : 'italic text-text-faint'}`}>
                {draftName || t('variants.newName')}
              </span>
              <Tag label={t('status.new')} />
            </span>
            <span className="text-[11px] text-text-muted">{t('status.unsaved')}</span>
          </button>
        </li>
      )}
      {variants.map((variant) => {
        const selected = variant.id === selectedId
        return (
          <li key={variant.id} className="border-b border-border-soft">
            <button
              type="button"
              onClick={() => onSelect(variant.id)}
              aria-current={selected || undefined}
              className={rowClass(selected)}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-[13px] font-medium text-text">{variant.name}</span>
                <ResumeStatusTag stale={variant.stale} />
              </span>
              <span className="flex items-center justify-between gap-2 text-[11px] text-text-muted">
                <span className="min-w-0 truncate">
                  {variant.jobCount === 0 ? t('variants.usedByNone') : t('variants.usedBy', { count: variant.jobCount })}
                </span>
                <span className="shrink-0 text-text-faint">{t(`templates.${variant.templateId}.name`)}</span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

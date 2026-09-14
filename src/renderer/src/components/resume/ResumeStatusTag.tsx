import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Tag from '../ui/Tag'

/**
 * The one chip that says what state a tailored resume is in, used by the
 * variant list, the details panel, the job card and the job detail modal so
 * "stale" looks the same everywhere it appears. `stale` means the master was
 * saved after this variant was written; the variant still attaches as-is.
 */
export default function ResumeStatusTag({ stale, compact = false }: { stale: boolean; compact?: boolean }): ReactElement {
  const { t } = useTranslation('resumes')
  if (stale) return <Tag label={t('status.stale')} tone="warning" />
  return <Tag label={compact ? t('status.tailored') : t('status.current')} tone="success" />
}

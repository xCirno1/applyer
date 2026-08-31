import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../ui/Button'
import Tag from '../ui/Tag'
import Tooltip from '../ui/Tooltip'
import { useFormatters } from '../../i18n/format'
import type { CompanyBoardRecord } from '@shared/types/companyBoard'

/** Provider names are proper nouns and stay untranslated. */
const PROVIDER_LABELS: Record<CompanyBoardRecord['provider'], string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  workday: 'Workday'
}

interface Props {
  board: CompanyBoardRecord
  toggling: boolean
  onToggle: () => void
  onRemove: () => void
}

/**
 * One tracked board. The status line is the point of the row: a board that
 * has quietly stopped answering (a renamed slug, a company that moved ATS)
 * otherwise just contributes nothing to every search with nothing to show
 * for it — and "0 open roles" has to read as a real answer rather than an
 * error, because on these APIs it is one.
 */
export default function CompanyBoardRow({ board, toggling, onToggle, onRemove }: Props): ReactElement {
  const { t } = useTranslation('indexedJobs')
  const format = useFormatters()

  const status = board.lastError
    ? { text: board.lastError, tone: 'danger' as const }
    : board.lastCheckedAt === null
      ? { text: t('boards.notCheckedYet'), tone: 'muted' as const }
      : { text: t('boards.openRoles', { count: board.lastJobCount ?? 0 }), tone: 'muted' as const }

  return (
    <div
      className={`flex items-center gap-2 border border-border-soft bg-canvas-soft px-2 py-1.5 text-[12px] ${
        board.enabled ? '' : 'opacity-60'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-text">{board.companyName}</span>
          <Tag label={PROVIDER_LABELS[board.provider]} tone="neutral" />
          {!board.enabled && <Tag label={t('boards.paused')} tone="warning" />}
          {board.addedBy === 'agent' && <Tag label={t('exclusions.byAgent')} tone="neutral" />}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-text-faint">
          <span className="truncate" title={board.site ? `${board.token} · ${board.site}` : board.token}>
            {board.site ? `${board.token} · ${board.site}` : board.token}
          </span>
          <span className={`truncate ${status.tone === 'danger' ? 'text-danger' : ''}`}>· {status.text}</span>
          {board.lastCheckedAt && <span className="shrink-0">· {format.date(board.lastCheckedAt)}</span>}
        </div>
      </div>

      <Tooltip label={board.enabled ? t('boards.pauseTooltip') : t('boards.resumeTooltip')}>
        <Button size="sm" variant="ghost" loading={toggling} onClick={onToggle}>
          {board.enabled ? t('boards.pause') : t('boards.resume')}
        </Button>
      </Tooltip>
      <Button size="sm" variant="ghost" onClick={onRemove}>
        {t('boards.remove')}
      </Button>
    </div>
  )
}

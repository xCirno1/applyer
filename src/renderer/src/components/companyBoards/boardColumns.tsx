import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../ui/Button'
import Tag from '../ui/Tag'
import Tooltip from '../ui/Tooltip'
import { useFormatters } from '../../i18n/format'
import { boardAddress, boardStatus, boardStatusRank, type BoardStatus } from './boardStatus'
import type { DataTableColumn } from '../ui/DataTable'
import type { CellAccessors } from '../ui/dataTable'
import type { CompanyBoardRecord } from '@shared/types/companyBoard'

/** Provider names are proper nouns and stay untranslated. */
export const PROVIDER_LABELS: Record<CompanyBoardRecord['provider'], string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  workday: 'Workday'
}

function providerLabel(board: CompanyBoardRecord): string {
  return PROVIDER_LABELS[board.provider] ?? board.provider
}

/**
 * What each column sorts and filters by, for `useSortableTable`.
 *
 * Kept beside the columns but separate from them: these are plain functions
 * over a record, so they need no translation and no hook, and the panel can
 * pass them straight to the hook.
 *
 * The status column is the one that cannot sort on what it renders. Its cell
 * is a sentence ("3 open roles", or a provider's error text), so sorting it as
 * text would order boards by the first letter of an error message;
 * `boardStatusRank` puts the boards that need attention first instead, on the
 * descending click a column gets first.
 */
export const BOARD_TABLE_VALUES: CellAccessors<CompanyBoardRecord> = {
  company: (board) => board.companyName,
  provider: providerLabel,
  // The whole address: a Workday board is found by its tenant or its career
  // site, and neither is what the row leads with.
  board: (board) => boardAddress(board).full,
  status: (board) => boardStatusRank(boardStatus(board)),
  // Sorted on the parsed timestamp rather than the formatted date, which
  // orders "1 Feb" before "3 Jan" in most locales. An unparseable value yields
  // NaN, which the table treats as missing.
  checked: (board) => (board.lastCheckedAt ? Date.parse(board.lastCheckedAt) : null)
}

/** The columns the filter box searches: the three that hold text a person would type. */
export const BOARD_SEARCH_KEYS = ['company', 'provider', 'board']

interface RowHandlers {
  /** Id of the board whose Pause/Resume request is in flight, if any. */
  togglingId: string | null
  /** Boards with a fetch in flight — a bulk fetch has many at once, so this is a set rather than one id. */
  fetchingIds: ReadonlySet<string>
  onToggle: (board: CompanyBoardRecord) => void
  onFetch: (board: CompanyBoardRecord) => void
  onRemove: (board: CompanyBoardRecord) => void
}

/**
 * The watchlist's columns.
 *
 * The last result is the point of the table: a board that has quietly stopped
 * answering (a renamed slug, a company that moved ATS) otherwise contributes
 * nothing to every search with nothing to show for it, and "0 open roles" has
 * to read as a real answer rather than an error, because on these APIs it is
 * one.
 */
export function useBoardColumns({
  togglingId,
  fetchingIds,
  onToggle,
  onFetch,
  onRemove
}: RowHandlers): DataTableColumn<CompanyBoardRecord>[] {
  const { t } = useTranslation('indexedJobs')
  const format = useFormatters()

  return useMemo(() => {
    // "Reached, but nobody has counted it" is a different answer from "0 open
    // roles": a Workday board is filtered by Workday, so a keyword search
    // visits it without ever counting it, and the Fetch button in this same
    // row is what answers the question.
    const statusText = (status: BoardStatus): string => {
      if (status.kind === 'error') return status.message
      if (status.kind === 'unchecked') return t('boards.notCheckedYet')
      if (status.kind === 'uncounted') return t('boards.rolesNotCounted')
      return t('boards.openRoles', { count: status.count })
    }

    return [
      {
        key: 'company',
        header: t('boards.colCompany'),
        sortable: true,
        render: (board) => (
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-text" title={board.companyName}>
              {board.companyName}
            </span>
            {!board.enabled && <Tag label={t('boards.paused')} tone="warning" />}
            {board.addedBy === 'agent' && <Tag label={t('exclusions.byAgent')} tone="neutral" />}
          </div>
        )
      },
      {
        key: 'provider',
        header: t('boards.colProvider'),
        sortable: true,
        className: 'text-text-muted',
        render: providerLabel
      },
      {
        key: 'board',
        header: t('boards.colBoard'),
        sortable: true,
        headerTip: t('boards.colBoardTip'),
        className: 'text-text-muted',
        render: (board) => {
          const address = boardAddress(board)
          return (
            <span className="block truncate" title={address.full}>
              {address.token}
              {address.site && <span className="text-text-faint"> / {address.site}</span>}
            </span>
          )
        }
      },
      {
        key: 'status',
        header: t('boards.colStatus'),
        sortable: true,
        headerTip: t('boards.colStatusTip'),
        render: (board) => {
          const status = boardStatus(board)
          const text = statusText(status)
          return (
            <span
              className={`block truncate ${status.kind === 'error' ? 'text-danger' : 'text-text-muted'}`}
              title={text}
            >
              {text}
            </span>
          )
        }
      },
      {
        key: 'checked',
        header: t('boards.colChecked'),
        sortable: true,
        className: 'whitespace-nowrap tabular-nums text-text-faint',
        render: (board) => (board.lastCheckedAt ? format.date(board.lastCheckedAt) : '')
      },
      {
        key: 'actions',
        header: t('boards.colActions'),
        align: 'right',
        render: (board) => (
          <div className="flex items-center justify-end gap-1">
            {/* First of the three: on a board that has never been searched
                it is the only way to fill this row's last result in without
                running a job search. */}
            <Tooltip label={t('boards.fetchTooltip')}>
              <Button size="sm" variant="ghost" loading={fetchingIds.has(board.id)} onClick={() => onFetch(board)}>
                {t('boards.fetch')}
              </Button>
            </Tooltip>
            <Tooltip label={board.enabled ? t('boards.pauseTooltip') : t('boards.resumeTooltip')}>
              <Button size="sm" variant="ghost" loading={togglingId === board.id} onClick={() => onToggle(board)}>
                {board.enabled ? t('boards.pause') : t('boards.resume')}
              </Button>
            </Tooltip>
            <Button size="sm" variant="ghost" onClick={() => onRemove(board)}>
              {t('boards.remove')}
            </Button>
          </div>
        )
      }
    ]
  }, [t, format, togglingId, fetchingIds, onToggle, onFetch, onRemove])
}

import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '../ui/Tooltip'
import { sourceLabel } from './runFormat'
import type { RunSourceStats } from '@shared/types/run'

/**
 * The per-source table: one row per site the run touched, in the order they
 * first appeared, with the search and pipeline counts side by side so a
 * site that returns a lot but queues nothing (or is blocked every time)
 * stands out on one line. Column headings are short and carry the
 * definition in a tooltip; the header row is the only place there is room.
 */

type Column = {
  key: keyof Omit<RunSourceStats, 'source'>
  label: 'searches' | 'results' | 'blocked' | 'warned' | 'read' | 'queued' | 'filled' | 'submitted' | 'failed' | 'excluded'
  tone?: 'danger' | 'warning'
}

const COLUMNS: Column[] = [
  { key: 'searches', label: 'searches' },
  { key: 'results', label: 'results' },
  { key: 'blocked', label: 'blocked', tone: 'danger' },
  { key: 'warned', label: 'warned', tone: 'warning' },
  { key: 'detailsRead', label: 'read' },
  { key: 'queued', label: 'queued' },
  { key: 'filled', label: 'filled' },
  { key: 'submitted', label: 'submitted' },
  { key: 'failed', label: 'failed', tone: 'danger' },
  { key: 'excluded', label: 'excluded' }
]

export default function SourceTable({ sources }: { sources: RunSourceStats[] }): ReactElement {
  const { t } = useTranslation('runs')

  if (sources.length === 0) {
    return <p className="py-1 text-[12px] text-text-faint">{t('sources.empty')}</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-border-soft text-[11px] text-text-faint">
            <th className="py-1 pr-2 text-left font-medium">{t('sources.source')}</th>
            {COLUMNS.map((column) => (
              <th key={column.key} className="py-1 pl-2 text-right font-medium">
                <Tooltip label={t(`sources.tips.${column.label}`)}>
                  <span className="cursor-help underline decoration-dotted underline-offset-2">
                    {t(`sources.${column.label}`)}
                  </span>
                </Tooltip>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sources.map((row) => (
            <tr key={row.source} className="border-b border-border-soft">
              <td className="whitespace-nowrap py-1 pr-2 text-text">{sourceLabel(row.source)}</td>
              {COLUMNS.map((column) => {
                const value = row[column.key]
                const toneClass =
                  value > 0 && column.tone === 'danger'
                    ? 'text-danger'
                    : value > 0 && column.tone === 'warning'
                      ? 'text-warning'
                      : value === 0
                        ? 'text-text-faint'
                        : 'text-text'
                return (
                  <td key={column.key} className={`py-1 pl-2 text-right tabular-nums ${toneClass}`}>
                    {value}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

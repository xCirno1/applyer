import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { formatMillis } from './runFormat'
import type { RunToolStats } from '@shared/types/run'

/** Per-tool call counts, most called first, under the group's totals. */
export default function ToolTable({ tools }: { tools: RunToolStats }): ReactElement {
  const { t } = useTranslation('runs')

  if (tools.byTool.length === 0) {
    return <p className="py-1 text-[12px] text-text-faint">{t('tools.empty')}</p>
  }

  return (
    <table className="w-full border-collapse text-[12px]">
      <thead>
        <tr className="border-b border-border-soft text-[11px] text-text-faint">
          <th className="py-1 pr-2 text-left font-medium">{t('tools.tool')}</th>
          <th className="py-1 pl-2 text-right font-medium">{t('tools.calls')}</th>
          <th className="py-1 pl-2 text-right font-medium">{t('tools.errors')}</th>
          <th className="py-1 pl-2 text-right font-medium">{t('tools.avg')}</th>
        </tr>
      </thead>
      <tbody>
        {tools.byTool.map((row) => (
          <tr key={row.tool} className="border-b border-border-soft">
            <td className="truncate py-1 pr-2 font-mono text-[11px] text-text">{row.tool}</td>
            <td className="py-1 pl-2 text-right tabular-nums text-text">{row.calls}</td>
            <td className={`py-1 pl-2 text-right tabular-nums ${row.errors > 0 ? 'text-warning' : 'text-text-faint'}`}>
              {row.errors}
            </td>
            <td className="whitespace-nowrap py-1 pl-2 text-right tabular-nums text-text-muted">
              {formatMillis(row.avgDurationMs)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

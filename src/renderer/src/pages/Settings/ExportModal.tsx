import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import Checkbox from '../../components/ui/Checkbox'
import Select from '../../components/ui/Select'
import Skeleton from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/useToast'
import { useErrorMessage } from '../../i18n/formatError'
import { formatBytes } from '../../lib/formatBytes'
import { useTheme } from '../../providers/ThemeContext'
import { allDomainsSelected, totalJsonBytes } from '@shared/types/dataTransfer'
import type { ExportSelection, ExportDomain, ExportSizes, CsvTable } from '@shared/types/dataTransfer'

const DOMAIN_KEYS = {
  jobs: { label: 'data.domainJobs', hint: 'data.domainJobsHint' },
  indexedJobs: { label: 'data.domainIndexedJobs', hint: 'data.domainIndexedJobsHint' },
  exclusions: { label: 'data.domainExclusions', hint: 'data.domainExclusionsHint' },
  companyBoards: { label: 'data.domainCompanyBoards', hint: 'data.domainCompanyBoardsHint' },
  profile: { label: 'data.domainProfile', hint: 'data.domainProfileHint' },
  settings: { label: 'data.domainSettings', hint: 'data.domainSettingsHint' },
  theme: { label: 'data.domainTheme', hint: 'data.domainThemeHint' }
} as const satisfies Record<ExportDomain, { label: string; hint: string }>

const DOMAIN_ORDER: ExportDomain[] = [
  'jobs',
  'indexedJobs',
  'exclusions',
  'companyBoards',
  'profile',
  'settings',
  'theme'
]

export default function ExportModal({ open, onClose }: { open: boolean; onClose: () => void }): ReactElement | null {
  const { t } = useTranslation('settings')
  const toast = useToast()
  const errorMessage = useErrorMessage()
  const { state: themeState } = useTheme()
  const [format, setFormat] = useState<'json' | 'csv'>('json')
  const [selection, setSelection] = useState<ExportSelection>(allDomainsSelected())
  const [csvTable, setCsvTable] = useState<CsvTable>('jobs')
  const [exporting, setExporting] = useState(false)
  const [sizes, setSizes] = useState<ExportSizes | null>(null)

  // Sizes are intrinsic per-domain values, independent of which checkboxes
  // are currently ticked — fetched once per open so toggling a checkbox
  // just re-sums already-known numbers instead of round-tripping again.
  // Stale sizes from a previous open are left showing (rather than cleared
  // to a skeleton) while the refetch is in flight, to avoid a layout flicker
  // on every reopen — only the very first open in a session shows a loading
  // state. `theme` is the one domain the main process can't read for itself
  // (see exportBundle.ts), so it rides along on this call, and a re-open
  // after editing Appearance elsewhere naturally picks up the latest state.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    window.api.data.getExportSizes(themeState).then((result) => {
      if (!cancelled) setSizes(result)
    })
    return () => {
      cancelled = true
    }
  }, [open, themeState])

  if (!open) return null

  const toggle = (domain: ExportDomain, checked: boolean): void => setSelection((prev) => ({ ...prev, [domain]: checked }))

  const selectedCount = DOMAIN_ORDER.filter((d) => selection[d]).length

  const totalBytes = format === 'json' ? (sizes ? totalJsonBytes(sizes, selection) : 0) : (sizes?.[csvTable].csv ?? 0)

  const handleExport = async (): Promise<void> => {
    setExporting(true)
    const result =
      format === 'json'
        ? await window.api.data.exportJson(
            selection,
            {
              title: t('data.exportDialogTitle'),
              filterName: 'JSON'
            },
            themeState
          )
        : await window.api.data.exportCsv(csvTable, {
            title: t('data.exportCsvDialogTitle'),
            filterName: 'CSV'
          })
    setExporting(false)
    if (result.canceled) return
    if (!result.ok) {
      toast.error(result.error ? errorMessage(result.error) : t('data.exportFailed'))
      return
    }
    toast.success(t('data.exportedTo', { path: result.filePath }))
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={t('data.exportModalTitle')} width="max-w-md">
      <div className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-text-muted">{t('data.format')}</span>
          <div className="flex gap-1.5">
            <Button variant={format === 'json' ? 'primary' : 'secondary'} size="sm" onClick={() => setFormat('json')}>
              JSON
            </Button>
            <Button variant={format === 'csv' ? 'primary' : 'secondary'} size="sm" onClick={() => setFormat('csv')}>
              CSV
            </Button>
          </div>
          <span className="text-[11px] text-text-faint">
            {format === 'json' ? t('data.formatJsonHint') : t('data.formatCsvHint')}
          </span>
        </div>

        {format === 'json' ? (
          <div className="flex flex-col gap-2.5 border-t border-border-soft pt-3">
            {DOMAIN_ORDER.map((domain) => (
              <div key={domain} className="flex items-start justify-between gap-2">
                <Checkbox
                  label={t(DOMAIN_KEYS[domain].label)}
                  hint={t(DOMAIN_KEYS[domain].hint)}
                  checked={selection[domain]}
                  onChange={(checked) => toggle(domain, checked)}
                />
                <span className="mt-0.5 shrink-0 text-[11px] text-text-faint">
                  {!sizes ? <Skeleton className="h-3 w-10" /> : formatBytes(sizes[domain].json)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 border-t border-border-soft pt-3">
            <Select
              label={t('data.tableToExport')}
              options={[
                { value: 'jobs', label: t('data.domainJobs') },
                { value: 'indexedJobs', label: t('data.domainIndexedJobs') },
                { value: 'exclusions', label: t('data.domainExclusions') },
                { value: 'companyBoards', label: t('data.domainCompanyBoards') }
              ]}
              value={csvTable}
              onChange={(v) => setCsvTable(v as CsvTable)}
            />
            <span className="text-[11px] text-text-faint">
              {!sizes ? <Skeleton className="h-3 w-10" /> : formatBytes(sizes[csvTable].csv)}
            </span>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-border-soft pt-3">
          <span className="text-[12px] text-text-muted">
            {t('data.totalSize')}
            {!sizes ? <Skeleton className="inline-block h-3 w-12 align-middle" /> : formatBytes(totalBytes)}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={exporting}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
            <Button
              variant="primary"
              loading={exporting}
              disabled={format === 'json' && selectedCount === 0}
              onClick={handleExport}
            >
              {t('data.exportAction')}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import Checkbox from '../../components/ui/Checkbox'
import { useToast } from '../../components/ui/useToast'
import { useErrorMessage } from '../../i18n/formatError'
import { useJobsStore } from '../../state/jobsStore'
import { useFormatters } from '../../i18n/format'
import { useTheme } from '../../providers/ThemeContext'
import { allDomainsSelected } from '@shared/types/dataTransfer'
import type { ExportBundle, ExportDomain, ExportSelection, ImportDomainCounts } from '@shared/types/dataTransfer'

const DOMAIN_KEYS = {
  jobs: 'data.domainJobs',
  indexedJobs: 'data.domainIndexedJobs',
  exclusions: 'data.domainExclusions',
  companyBoards: 'data.domainCompanyBoards',
  profile: 'data.domainProfile',
  settings: 'data.domainSettings',
  theme: 'data.domainTheme'
} as const satisfies Record<ExportDomain, string>

const DOMAIN_ORDER: ExportDomain[] = [
  'jobs',
  'indexedJobs',
  'exclusions',
  'companyBoards',
  'profile',
  'settings',
  'theme'
]

const OVERWRITE_DOMAINS: ExportDomain[] = ['profile', 'settings', 'theme']

/** The rest are merged into what's already there, so their hint counts rows rather than warning about a replacement. */
const MERGE_DOMAINS: ExportDomain[] = ['jobs', 'indexedJobs', 'exclusions', 'companyBoards']

function domainCount(domain: ExportDomain, counts: ImportDomainCounts): number | undefined {
  return counts[domain]
}

interface LoadedFile {
  bundle: ExportBundle
  counts: ImportDomainCounts
  filePath: string
}

export default function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }): ReactElement | null {
  const { t } = useTranslation('settings')
  const toast = useToast()
  const errorMessage = useErrorMessage()
  const format = useFormatters()
  const fetchAllColumns = useJobsStore((s) => s.fetchAllColumns)
  const { importTheme } = useTheme()
  const [picking, setPicking] = useState(false)
  const [pickError, setPickError] = useState<string | null>(null)
  const [file, setFile] = useState<LoadedFile | null>(null)
  const [selection, setSelection] = useState<ExportSelection>(allDomainsSelected(false))
  const [importing, setImporting] = useState(false)

  if (!open) return null

  const reset = (): void => {
    setFile(null)
    setPickError(null)
    setSelection(allDomainsSelected(false))
  }

  const handleClose = (): void => {
    reset()
    onClose()
  }

  const handlePickFile = async (): Promise<void> => {
    setPicking(true)
    setPickError(null)
    const result = await window.api.data.pickImportFile({
      title: t('data.importDialogTitle'),
      filterName: 'JSON'
    })
    setPicking(false)
    if (result.canceled) return
    if (!result.ok || !result.bundle) {
      setPickError(result.error ? errorMessage(result.error) : t('data.readFailed'))
      return
    }
    const counts = result.counts ?? {}
    const presentDomains = DOMAIN_ORDER.filter((d) => domainCount(d, counts) !== undefined)
    setFile({ bundle: result.bundle, counts, filePath: result.filePath ?? '' })
    // Everything the file actually carries starts ticked, derived from the
    // domain list rather than restated per domain so a new one can't be
    // silently left unselectable here.
    setSelection(
      DOMAIN_ORDER.reduce<ExportSelection>(
        (acc, domain) => ({ ...acc, [domain]: presentDomains.includes(domain) }),
        allDomainsSelected(false)
      )
    )
  }

  const toggle = (domain: ExportDomain, checked: boolean): void => setSelection((prev) => ({ ...prev, [domain]: checked }))

  const presentDomains = file ? DOMAIN_ORDER.filter((d) => domainCount(d, file.counts) !== undefined) : []
  const selectedCount = presentDomains.filter((d) => selection[d]).length
  const willOverwrite = presentDomains.some((d) => OVERWRITE_DOMAINS.includes(d) && selection[d])

  const handleImport = async (): Promise<void> => {
    if (!file) return
    setImporting(true)
    const result = await window.api.data.import(file.bundle, selection)
    setImporting(false)
    if (!result.ok || !result.summary) {
      toast.error(result.error ? errorMessage(result.error) : t('data.importFailed'))
      return
    }
    const parts: string[] = []
    if (result.summary.jobs) parts.push(t('data.jobsAdded', { count: result.summary.jobs.imported }))
    if (result.summary.indexedJobs)
      parts.push(t('data.indexedJobsAdded', { count: result.summary.indexedJobs.imported }))
    if (result.summary.exclusions)
      parts.push(t('data.exclusionsAdded', { count: result.summary.exclusions.imported }))
    if (result.summary.companyBoards)
      parts.push(t('data.companyBoardsAdded', { count: result.summary.companyBoards.imported }))
    if (result.summary.profile) parts.push(t('data.profileUpdated'))
    if (result.summary.settings) parts.push(t('data.settingsUpdated'))
    // Unlike every other domain, main never applies this one (it doesn't
    // have the renderer's localStorage) — it just carried `theme` through
    // validation, so applying and reporting it both happen here instead of
    // coming back in `result.summary`.
    if (selection.theme && file.bundle.data.theme) {
      importTheme(file.bundle.data.theme)
      parts.push(t('data.themeUpdated'))
    }
    toast.success(
      parts.length > 0
        ? t('data.importComplete', { parts: parts.join(', ') })
        : t('data.importCompleteEmpty')
    )

    if (result.summary.jobs && result.summary.jobs.imported > 0) fetchAllColumns()

    handleClose()
  }

  return (
    <Modal open={open} onClose={handleClose} title={t('data.importModalTitle')} width="max-w-md">
      <div className="flex flex-col gap-3.5">
        <p className="text-[12px] text-text-faint">{t('data.importOnlyJson')}</p>

        {!file && (
          <div className="flex flex-col gap-2">
            <Button variant="secondary" loading={picking} onClick={handlePickFile}>
              {t('data.chooseFile')}
            </Button>
            {pickError && <span className="text-[12px] text-danger">{pickError}</span>}
          </div>
        )}

        {file && (
          <>
            <div className="flex flex-col gap-0.5 border-t border-border-soft pt-3">
              <span className="text-[12px] text-text-muted">
                {t('data.exportedAt', { date: format.dateTime(file.bundle.exportedAt) })}
              </span>
              <button
                onClick={reset}
                className="w-fit cursor-pointer text-[11px] text-accent hover:underline"
                disabled={importing}
              >
                {t('data.chooseDifferent')}
              </button>
            </div>

            <div className="flex flex-col gap-2.5">
              {presentDomains.map((domain) => {
                const count = domainCount(domain, file.counts)
                const hint =
                  MERGE_DOMAINS.includes(domain)
                    ? t('data.recordsHint', { count: count ?? 0 })
                    : t('data.overwritesHint')
                return (
                  <Checkbox
                    key={domain}
                    label={t(DOMAIN_KEYS[domain])}
                    hint={hint}
                    checked={selection[domain]}
                    onChange={(checked) => toggle(domain, checked)}
                  />
                )
              })}
            </div>

            {willOverwrite && (
              <p className="border border-warning px-2 py-1.5 text-[12px] text-warning">
                {t('data.willOverwrite', {
                  domains: OVERWRITE_DOMAINS.filter((d) => selection[d])
                    .map((d) => t(DOMAIN_KEYS[d]).toLowerCase())
                    .join(' & ')
                })}
              </p>
            )}

            <div className="flex justify-end gap-2 border-t border-border-soft pt-3">
              <Button variant="ghost" onClick={handleClose} disabled={importing}>
                {t('actions.cancel', { ns: 'common' })}
              </Button>
              <Button variant="primary" loading={importing} disabled={selectedCount === 0} onClick={handleImport}>
                {t('data.importAction')}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

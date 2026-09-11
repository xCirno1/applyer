import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import Checkbox from '../../components/ui/Checkbox'
import { useToast } from '../../components/ui/useToast'
import { callIpc } from '../../lib/ipcCall'
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
  const [reviewingAutoStart, setReviewingAutoStart] = useState(false)

  if (!open) return null

  const reset = (): void => {
    setFile(null)
    setPickError(null)
    setSelection(allDomainsSelected(false))
    setReviewingAutoStart(false)
  }

  const handleClose = (): void => {
    reset()
    onClose()
  }

  const handlePickFile = async (): Promise<void> => {
    setPicking(true)
    setPickError(null)
    const result = await callIpc(
      'data.pickImportFile',
      () =>
        window.api.data.pickImportFile({
          title: t('data.importDialogTitle'),
          filterName: 'JSON'
        }),
      { ok: false as const, canceled: true }
    )
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

  const performImport = async (reviewedAutoStartCommand?: string): Promise<void> => {
    if (!file) return
    setImporting(true)
    const result = await callIpc(
      'data.import',
      () => window.api.data.import(file.bundle, selection, reviewedAutoStartCommand),
      { ok: false as const }
    )
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

  const importedAutoStartCommand =
    selection.settings && file?.bundle.data.settings?.autoStartCommand
      ? file.bundle.data.settings.autoStartCommand
      : null

  const handleImport = (): void => {
    if (importedAutoStartCommand) {
      setReviewingAutoStart(true)
      return
    }
    void performImport()
  }

  const closeOrBack = (): void => {
    if (reviewingAutoStart) {
      setReviewingAutoStart(false)
      return
    }
    handleClose()
  }

  return (
    <Modal
      open={open}
      onClose={closeOrBack}
      title={reviewingAutoStart ? t('data.autoStartReviewTitle') : t('data.importModalTitle')}
      width={reviewingAutoStart ? 'max-w-xl' : 'max-w-md'}
    >
      {reviewingAutoStart && importedAutoStartCommand ? (
        <div className="border-2 border-danger bg-canvas-soft">
          <div className="flex items-center gap-2 border-b-2 border-danger bg-danger px-3 py-2 text-white">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              className="h-7 w-7 shrink-0"
            >
              <path d="M12 3 22 21H2L12 3Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              <path d="M12 9v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="12" cy="17.5" r="1" fill="currentColor" />
            </svg>
            <div>
              <p className="text-[13px] font-bold uppercase tracking-wide">{t('data.autoStartReviewHeading')}</p>
              <p className="mt-0.5 text-[12px] font-medium">{t('data.autoStartReviewWarning')}</p>
            </div>
          </div>

          <div className="flex flex-col gap-3 p-3">
            <p className="text-[13px] font-medium text-danger">{t('data.autoStartReviewBody')}</p>
            <div>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-danger">
                {t('data.autoStartReviewCommandLabel')}
              </p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all border-2 border-danger bg-canvas-inset p-3 font-mono text-[13px] font-semibold text-danger">
                <code>{importedAutoStartCommand}</code>
              </pre>
            </div>
            <p className="text-[12px] text-text-muted">{t('data.autoStartReviewAdvice')}</p>
            <div className="flex justify-end gap-2 border-t border-danger pt-3">
              <Button variant="ghost" onClick={() => setReviewingAutoStart(false)} disabled={importing}>
                {t('data.autoStartReviewBack')}
              </Button>
              <Button
                variant="danger"
                loading={importing}
                onClick={() => void performImport(importedAutoStartCommand)}
              >
                {t('data.autoStartReviewConfirm')}
              </Button>
            </div>
          </div>
        </div>
      ) : (
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
      )}
    </Modal>
  )
}

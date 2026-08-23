import { useState, type ReactElement } from 'react'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import Checkbox from '../../components/ui/Checkbox'
import { useToast } from '../../components/ui/useToast'
import { useJobsStore } from '../../state/jobsStore'
import type { ExportBundle, ExportDomain, ExportSelection, ImportDomainCounts } from '@shared/types/dataTransfer'

const DOMAIN_LABELS: Record<ExportDomain, string> = {
  jobs: 'Job applications',
  exclusions: 'Excluded jobs',
  profile: 'Profile',
  settings: 'App settings'
}

const DOMAIN_ORDER: ExportDomain[] = ['jobs', 'exclusions', 'profile', 'settings']

const OVERWRITE_DOMAINS: ExportDomain[] = ['profile', 'settings']

function domainCount(domain: ExportDomain, counts: ImportDomainCounts): number | undefined {
  return counts[domain]
}

interface LoadedFile {
  bundle: ExportBundle
  counts: ImportDomainCounts
  filePath: string
}

export default function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }): ReactElement | null {
  const toast = useToast()
  const fetchAllColumns = useJobsStore((s) => s.fetchAllColumns)
  const [picking, setPicking] = useState(false)
  const [pickError, setPickError] = useState<string | null>(null)
  const [file, setFile] = useState<LoadedFile | null>(null)
  const [selection, setSelection] = useState<ExportSelection>({ jobs: false, exclusions: false, profile: false, settings: false })
  const [importing, setImporting] = useState(false)

  if (!open) return null

  const reset = (): void => {
    setFile(null)
    setPickError(null)
    setSelection({ jobs: false, exclusions: false, profile: false, settings: false })
  }

  const handleClose = (): void => {
    reset()
    onClose()
  }

  const handlePickFile = async (): Promise<void> => {
    setPicking(true)
    setPickError(null)
    const result = await window.api.data.pickImportFile()
    setPicking(false)
    if (result.canceled) return
    if (!result.ok || !result.bundle) {
      setPickError(result.error ?? 'Could not read that file.')
      return
    }
    const counts = result.counts ?? {}
    const presentDomains = DOMAIN_ORDER.filter((d) => domainCount(d, counts) !== undefined)
    setFile({ bundle: result.bundle, counts, filePath: result.filePath ?? '' })
    setSelection({
      jobs: presentDomains.includes('jobs'),
      exclusions: presentDomains.includes('exclusions'),
      profile: presentDomains.includes('profile'),
      settings: presentDomains.includes('settings')
    })
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
      toast.error(result.error ?? 'Import failed.')
      return
    }
    const parts: string[] = []
    if (result.summary.jobs) parts.push(`${result.summary.jobs.imported} job${result.summary.jobs.imported === 1 ? '' : 's'} added`)
    if (result.summary.exclusions)
      parts.push(`${result.summary.exclusions.imported} exclusion${result.summary.exclusions.imported === 1 ? '' : 's'} added`)
    if (result.summary.profile) parts.push('profile updated')
    if (result.summary.settings) parts.push('settings updated')
    toast.success(parts.length > 0 ? `Import complete — ${parts.join(', ')}.` : 'Import complete — nothing new to add.')

    if (result.summary.jobs && result.summary.jobs.imported > 0) fetchAllColumns()

    handleClose()
  }

  return (
    <Modal open={open} onClose={handleClose} title="Import data" width="max-w-md">
      <div className="flex flex-col gap-3.5">
        <p className="text-[12px] text-text-faint">
          Only accepts a JSON file previously produced by Export — CSV files cannot be imported.
        </p>

        {!file && (
          <div className="flex flex-col gap-2">
            <Button variant="secondary" loading={picking} onClick={handlePickFile}>
              Choose file…
            </Button>
            {pickError && <span className="text-[12px] text-danger">{pickError}</span>}
          </div>
        )}

        {file && (
          <>
            <div className="flex flex-col gap-0.5 border-t border-border-soft pt-3">
              <span className="text-[12px] text-text-muted">
                Exported {new Date(file.bundle.exportedAt).toLocaleString()}
              </span>
              <button
                onClick={reset}
                className="w-fit cursor-pointer text-[11px] text-accent hover:underline"
                disabled={importing}
              >
                Choose a different file
              </button>
            </div>

            <div className="flex flex-col gap-2.5">
              {presentDomains.map((domain) => {
                const count = domainCount(domain, file.counts)
                const hint =
                  domain === 'jobs' || domain === 'exclusions'
                    ? `${count} record${count === 1 ? '' : 's'} in the file — existing ones (matched by URL) are skipped.`
                    : 'Overwrites your current value.'
                return (
                  <Checkbox
                    key={domain}
                    label={DOMAIN_LABELS[domain]}
                    hint={hint}
                    checked={selection[domain]}
                    onChange={(checked) => toggle(domain, checked)}
                  />
                )
              })}
            </div>

            {willOverwrite && (
              <p className="border border-warning px-2 py-1.5 text-[12px] text-warning">
                This will overwrite your current {OVERWRITE_DOMAINS.filter((d) => selection[d]).map((d) => DOMAIN_LABELS[d].toLowerCase()).join(' and ')}.
              </p>
            )}

            <div className="flex justify-end gap-2 border-t border-border-soft pt-3">
              <Button variant="ghost" onClick={handleClose} disabled={importing}>
                Cancel
              </Button>
              <Button variant="primary" loading={importing} disabled={selectedCount === 0} onClick={handleImport}>
                Import
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

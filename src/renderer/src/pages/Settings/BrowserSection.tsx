import { useEffect, useState, type ReactElement } from 'react'
import Select from '../../components/ui/Select'
import Skeleton from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/useToast'
import type { BrowserPreference, ResolvedBrowserStatus } from '@shared/types/ipcEvents'

const PREFERENCE_OPTIONS = [
  { value: 'auto', label: 'Auto (recommended)' },
  { value: 'chrome', label: 'System Chrome' },
  { value: 'msedge', label: 'System Edge' },
  { value: 'managed', label: 'Managed download' }
]

const KIND_LABELS: Record<ResolvedBrowserStatus['kind'], string> = {
  unresolved: 'Not yet determined',
  'dev-bundled': 'Bundled Chromium (development build)',
  chrome: 'System Chrome',
  msedge: 'System Edge',
  managed: 'Managed download (Playwright Chromium)'
}

export default function BrowserSection(): ReactElement {
  const [preference, setPreferenceState] = useState<BrowserPreference | null>(null)
  const [status, setStatus] = useState<ResolvedBrowserStatus | null>(null)
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  const refresh = (): void => {
    window.api.browserSetup.getPreference().then(setPreferenceState)
    window.api.browserSetup.getStatus().then(setStatus)
  }

  useEffect(refresh, [])

  const handleChange = async (value: string): Promise<void> => {
    const next = value as BrowserPreference
    setSaving(true)
    setPreferenceState(next)
    await window.api.browserSetup.setPreference(next)
    setSaving(false)
    toast.success('Browser preference saved — takes effect the next time a browser is launched.')
    refresh()
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-text-muted">
        Applyer drives a Chromium-based browser to search and apply to jobs. By default it looks for your
        system&apos;s installed Chrome or Edge first, and only downloads its own copy if neither is found.
      </p>

      <div className="flex flex-col gap-2 border border-border-soft p-3">
        <h2 className="text-[13px] font-semibold text-text">Currently active</h2>
        {!status ? (
          <Skeleton className="h-7 w-full" />
        ) : (
          <div className="flex flex-col gap-1 text-[12px] text-text-muted">
            <span className="text-text">{KIND_LABELS[status.kind]}</span>
            {status.executablePath && <span className="truncate font-mono text-[11px]">{status.executablePath}</span>}
            {!status.packaged && (
              <span>
                This is a development build — it always uses Playwright&apos;s bundled Chromium, regardless of the
                preference below. The preference only takes effect in a packaged build.
              </span>
            )}
            {status.packaged && status.kind === 'unresolved' && (
              <span>Resolves the first time a browser is needed, e.g. searching or applying to a job.</span>
            )}
          </div>
        )}
      </div>

      {preference === null ? (
        <Skeleton className="h-7 w-48" />
      ) : (
        <Select label="Preferred browser" options={PREFERENCE_OPTIONS} value={preference} onChange={handleChange} disabled={saving} />
      )}
      <p className="text-[12px] text-text-muted">
        Auto tries system Chrome, then Edge, then a one-time managed download. Picking Chrome or Edge specifically
        fails with an error (instead of silently trying something else) if that browser isn&apos;t installed.
        Managed download always uses Applyer&apos;s own downloaded copy.
      </p>
    </div>
  )
}

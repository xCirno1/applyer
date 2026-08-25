import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Select from '../../components/ui/Select'
import Skeleton from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/useToast'
import type { BrowserPreference, ResolvedBrowserStatus } from '@shared/types/ipcEvents'

const KIND_KEYS = {
  unresolved: 'browser.kindUnresolved',
  'dev-bundled': 'browser.kindDevBundled',
  chrome: 'browser.kindChrome',
  msedge: 'browser.kindMsedge',
  managed: 'browser.kindManaged'
} as const satisfies Record<ResolvedBrowserStatus['kind'], string>

export default function BrowserSection(): ReactElement {
  const [preference, setPreferenceState] = useState<BrowserPreference | null>(null)
  const [status, setStatus] = useState<ResolvedBrowserStatus | null>(null)
  const [saving, setSaving] = useState(false)
  const { t } = useTranslation('settings')
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
    toast.success(t('browser.saved'))
    refresh()
  }

  const preferenceOptions = [
    { value: 'auto', label: t('browser.optionAuto') },
    { value: 'chrome', label: t('browser.optionChrome') },
    { value: 'msedge', label: t('browser.optionEdge') },
    { value: 'managed', label: t('browser.optionManaged') }
  ]

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-text-muted">{t('browser.intro')}</p>

      <div className="flex flex-col gap-2 border border-border-soft p-3">
        <h2 className="text-[13px] font-semibold text-text">{t('browser.active')}</h2>
        {!status ? (
          <Skeleton className="h-7 w-full" />
        ) : (
          <div className="flex flex-col gap-1 text-[12px] text-text-muted">
            <span className="text-text">{t(KIND_KEYS[status.kind])}</span>
            {status.executablePath && <span className="truncate font-mono text-[11px]">{status.executablePath}</span>}
            {!status.packaged && (
              <span>{t('browser.devBuildNote')}</span>
            )}
            {status.packaged && status.kind === 'unresolved' && (
              <span>{t('browser.unresolvedNote')}</span>
            )}
          </div>
        )}
      </div>

      {preference === null ? (
        <Skeleton className="h-7 w-48" />
      ) : (
        <Select
          label={t('browser.preferred')}
          options={preferenceOptions}
          value={preference}
          onChange={handleChange}
          disabled={saving}
        />
      )}
      <p className="text-[12px] text-text-muted">{t('browser.outro')}</p>
    </div>
  )
}

import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Select from '../../components/ui/Select'
import Skeleton from '../../components/ui/Skeleton'
import Checkbox from '../../components/ui/Checkbox'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import WarningPanel from '../../components/ui/WarningPanel'
import RemoteBrowserCard from '../../components/settings/RemoteBrowserCard'
import { useToast } from '../../components/ui/useToast'
import { callIpc } from '../../lib/ipcCall'
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
  const [allowLocalAddresses, setAllowLocalAddressesState] = useState<boolean | null>(null)
  const [savingLocalAddresses, setSavingLocalAddresses] = useState(false)
  const [confirmLocalAddresses, setConfirmLocalAddresses] = useState(false)
  const { t } = useTranslation('settings')
  const toast = useToast()

  const refresh = (): void => {
    void callIpc('browserSetup.getPreference', () => window.api.browserSetup.getPreference(), 'auto').then(
      setPreferenceState
    )
    void callIpc('browserSetup.getStatus', () => window.api.browserSetup.getStatus(), {
      packaged: false,
      kind: 'unresolved',
      executablePath: null
    }).then(setStatus)
    void callIpc(
      'browserSetup.getAllowLocalAddresses',
      () => window.api.browserSetup.getAllowLocalAddresses(),
      false
    ).then(setAllowLocalAddressesState)
  }

  const saveAllowLocalAddresses = async (allowed: boolean): Promise<void> => {
    setSavingLocalAddresses(true)
    const result = await callIpc(
      'browserSetup.setAllowLocalAddresses',
      () => window.api.browserSetup.setAllowLocalAddresses(allowed),
      { ok: false }
    )
    setSavingLocalAddresses(false)
    setConfirmLocalAddresses(false)
    if (result.ok) toast.success(t('browser.localAddressesSaved'))
    else toast.error(t('browser.localAddressesSaveFailed'))
    refresh()
  }

  const handleAllowLocalAddressesChange = (allowed: boolean): void => {
    if (allowed) setConfirmLocalAddresses(true)
    else void saveAllowLocalAddresses(false)
  }

  useEffect(refresh, [])

  const handleChange = async (value: string): Promise<void> => {
    const next = value as BrowserPreference
    setSaving(true)
    setPreferenceState(next)
    const result = await callIpc(
      'browserSetup.setPreference',
      () => window.api.browserSetup.setPreference(next),
      { ok: false }
    )
    setSaving(false)
    // Announced as saved only if it was: `refresh()` below would
    // otherwise snap the control back to the stored value right after
    // a success toast.
    if (result.ok) toast.success(t('browser.saved'))
    else toast.error(t('browser.saveFailed'))
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

      <RemoteBrowserCard />

      <WarningPanel title={t('browser.networkAccessTitle')}>
        {allowLocalAddresses === null ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <Checkbox
            id="allow-local-addresses"
            label={t('browser.allowLocalAddresses')}
            hint={t('browser.allowLocalAddressesHint')}
            checked={allowLocalAddresses}
            onChange={handleAllowLocalAddressesChange}
            disabled={savingLocalAddresses}
          />
        )}
      </WarningPanel>

      <ConfirmDialog
        open={confirmLocalAddresses}
        title={t('browser.localAddressesConfirmTitle')}
        message={t('browser.localAddressesConfirmMessage')}
        confirmLabel={t('browser.localAddressesConfirm')}
        danger
        loading={savingLocalAddresses}
        onConfirm={() => void saveAllowLocalAddresses(true)}
        onCancel={() => setConfirmLocalAddresses(false)}
      />
    </div>
  )
}

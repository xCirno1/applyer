import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import StorageModeCard from '../../components/onboarding/StorageModeCard'
import OnboardingShell from '../../components/onboarding/OnboardingShell'
import Button from '../../components/ui/Button'
import Skeleton from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/useToast'
import { useErrorMessage } from '../../i18n/formatError'
import type { StorageMode } from '@shared/types/profile'

export default function StorageModeChoice({
  onNext,
  onBack
}: {
  onNext: () => void
  onBack: () => void
}): ReactElement {
  const [mode, setMode] = useState<StorageMode>('encrypted')
  const [encryptionAvailable, setEncryptionAvailable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const { t } = useTranslation('onboarding')
  const toast = useToast()
  const errorMessage = useErrorMessage()

  useEffect(() => {
    let cancelled = false
    window.api.onboarding
      .getStatus()
      .then((status) => {
        if (cancelled) return
        setEncryptionAvailable(status.encryptionAvailable)
        if (!status.encryptionAvailable) setMode('plaintext')
        if (status.storageMode) setMode(status.storageMode)
      })
      .catch((err: unknown) => {
        // Nothing to retry against and nothing lost: the cards still work,
        // and the encrypted option stays offered because the more
        // protective default is the safer thing to be wrong about. The
        // write itself reports its own failure.
        console.error(`Could not read the stored storage mode: ${String(err)}`)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleNext = async (): Promise<void> => {
    setSaving(true)
    const result = await window.api.onboarding.setStorageMode(mode)
    setSaving(false)
    if (!result.ok) {
      toast.error(result.error ? errorMessage(result.error) : t('storage.saveFailed'))
      return
    }
    onNext()
  }

  return (
    <OnboardingShell
      step="storage"
      title={t('storage.title')}
      subtitle={t('storage.intro')}
      back={
        <Button variant="ghost" onClick={onBack}>
          {t('nav.back')}
        </Button>
      }
      actions={
        <Button variant="primary" onClick={handleNext} loading={saving} disabled={loading}>
          {t('nav.next')}
        </Button>
      }
    >
      {loading ? (
        <div className="flex gap-3">
          <Skeleton className="h-24 flex-1" />
          <Skeleton className="h-24 flex-1" />
        </div>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row">
          <StorageModeCard
            title={t('storage.encrypted')}
            recommended
            description={t('storage.encryptedDescription')}
            selected={mode === 'encrypted'}
            disabled={!encryptionAvailable}
            disabledReason={t('storage.unavailable')}
            onSelect={() => setMode('encrypted')}
          />
          <StorageModeCard
            title={t('storage.plaintext')}
            description={t('storage.plaintextDescription')}
            selected={mode === 'plaintext'}
            onSelect={() => setMode('plaintext')}
          />
        </div>
      )}
      <p className="mt-3 text-[11px] text-text-faint">{t('storage.changeLater')}</p>
    </OnboardingShell>
  )
}

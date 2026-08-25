import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import StorageModeCard from '../../components/onboarding/StorageModeCard'
import Button from '../../components/ui/Button'
import { useToast } from '../../components/ui/useToast'
import { useErrorMessage } from '../../i18n/formatError'
import type { StorageMode } from '@shared/types/profile'

export default function StorageModeChoice({ onNext, onBack }: { onNext: () => void; onBack: () => void }): ReactElement {
  const [mode, setMode] = useState<StorageMode>('encrypted')
  const [encryptionAvailable, setEncryptionAvailable] = useState(true)
  const [saving, setSaving] = useState(false)
  const { t } = useTranslation('onboarding')
  const toast = useToast()
  const errorMessage = useErrorMessage()

  useEffect(() => {
    window.api.onboarding.getStatus().then((status) => {
      setEncryptionAvailable(status.encryptionAvailable)
      if (!status.encryptionAvailable) setMode('plaintext')
      if (status.storageMode) setMode(status.storageMode)
    })
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
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[16px] font-medium text-text">{t('storage.title')}</h1>
        <p className="mt-1 text-[13px] text-text-muted">{t('storage.intro')}</p>
      </div>

      <div className="flex gap-3">
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

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          {t('nav.back')}
        </Button>
        <Button variant="primary" onClick={handleNext} loading={saving}>
          {t('nav.next')}
        </Button>
      </div>
    </div>
  )
}

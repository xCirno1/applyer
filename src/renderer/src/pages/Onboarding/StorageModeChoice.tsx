import { useEffect, useState, type ReactElement } from 'react'
import StorageModeCard from '../../components/onboarding/StorageModeCard'
import Button from '../../components/ui/Button'
import { useToast } from '../../components/ui/useToast'
import type { StorageMode } from '@shared/types/profile'

export default function StorageModeChoice({ onNext, onBack }: { onNext: () => void; onBack: () => void }): ReactElement {
  const [mode, setMode] = useState<StorageMode>('encrypted')
  const [encryptionAvailable, setEncryptionAvailable] = useState(true)
  const [saving, setSaving] = useState(false)
  const toast = useToast()

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
      toast.error(result.error ?? 'Failed to save storage preference.')
      return
    }
    onNext()
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[16px] font-medium text-text">How should we store your information locally?</h1>
        <p className="mt-1 text-[13px] text-text-muted">
          Everything stays on this computer either way — this only changes how it&apos;s stored on disk.
        </p>
      </div>

      <div className="flex gap-3">
        <StorageModeCard
          title="Encrypted"
          recommended
          description="Locked using this computer's built-in secure storage — the same kind of protection your browser uses for saved passwords. Only readable on this device, by your user account."
          selected={mode === 'encrypted'}
          disabled={!encryptionAvailable}
          disabledReason="Not available on this system (no OS keychain detected)."
          onSelect={() => setMode('encrypted')}
        />
        <StorageModeCard
          title="Plain text"
          description="Stored as regular, readable files on this computer. Simpler to back up or inspect yourself, but readable by anyone with access to this computer's files."
          selected={mode === 'plaintext'}
          onSelect={() => setMode('plaintext')}
        />
      </div>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" onClick={handleNext} loading={saving}>
          Next
        </Button>
      </div>
    </div>
  )
}

import { useEffect, useState, type ReactElement } from 'react'
import StorageModeCard from '../../components/onboarding/StorageModeCard'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import { useToast } from '../../components/ui/useToast'
import type { StorageMode } from '@shared/types/profile'

export default function StorageSection(): ReactElement {
  const [currentMode, setCurrentMode] = useState<StorageMode | null>(null)
  const [encryptionAvailable, setEncryptionAvailable] = useState(true)
  const [pendingMode, setPendingMode] = useState<StorageMode | null>(null)
  const [changing, setChanging] = useState(false)
  const toast = useToast()

  const refresh = (): void => {
    window.api.onboarding.getStatus().then((status) => {
      setCurrentMode(status.storageMode)
      setEncryptionAvailable(status.encryptionAvailable)
    })
  }

  useEffect(refresh, [])

  const handleConfirm = async (): Promise<void> => {
    if (!pendingMode) return
    setChanging(true)
    const result = await window.api.settings.changeStorageMode(pendingMode)
    setChanging(false)
    setPendingMode(null)
    if (result.ok) {
      toast.success('Storage mode changed — your profile and documents were re-written in the new format.')
      refresh()
    } else {
      toast.error(result.error ?? 'Failed to change storage mode.')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-text-muted">
        Everything stays on this computer either way — this only changes how it&apos;s stored on disk. Changing this
        re-writes your existing profile and documents in the new format.
      </p>

      <div className="flex gap-3">
        <StorageModeCard
          title="Encrypted"
          recommended
          description="Locked using this computer's built-in secure storage — only readable on this device, by your user account."
          selected={currentMode === 'encrypted'}
          disabled={!encryptionAvailable}
          disabledReason="Not available on this system (no OS keychain detected)."
          onSelect={() => setPendingMode('encrypted')}
        />
        <StorageModeCard
          title="Plain text"
          description="Stored as regular, readable files. Simpler to back up or inspect, but readable by anyone with access to this computer's files."
          selected={currentMode === 'plaintext'}
          onSelect={() => setPendingMode('plaintext')}
        />
      </div>

      <ConfirmDialog
        open={pendingMode !== null}
        title="Change storage mode"
        message={`This will re-write your profile and uploaded documents in ${pendingMode === 'encrypted' ? 'encrypted' : 'plain text'} form. It may take a moment.`}
        confirmLabel="Change"
        loading={changing}
        onConfirm={handleConfirm}
        onCancel={() => setPendingMode(null)}
      />
    </div>
  )
}

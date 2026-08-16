import { useState, type ReactElement } from 'react'
import Button from '../ui/Button'
import { useToast } from '../ui/useToast'
import type { CaptchaDetectedPayload } from '@shared/types/ipcEvents'

interface CaptchaAlertBannerProps {
  pending: CaptchaDetectedPayload[]
  onRemove: (taskId: string) => void
}

function CaptchaAlertRow({ item, onRemove }: { item: CaptchaDetectedPayload; onRemove: (taskId: string) => void }): ReactElement {
  const toast = useToast()
  const [busy, setBusy] = useState<'resume' | 'cancel' | null>(null)

  const handleResume = async (): Promise<void> => {
    setBusy('resume')
    const result = await window.api.browserControl.resumeTask(item.taskId)
    setBusy(null)
    if (result.ok) {
      onRemove(item.taskId)
      toast.success(`Resuming "${item.jobTitle}"…`)
    } else {
      toast.error(result.error ?? 'Still blocked — finish the challenge in the browser window first.')
    }
  }

  const handleCancel = async (): Promise<void> => {
    setBusy('cancel')
    const result = await window.api.browserControl.cancelTask(item.taskId)
    setBusy(null)
    if (result.ok) {
      onRemove(item.taskId)
      toast.info(`"${item.jobTitle}" moved to Failed.`)
    }
  }

  return (
    <div className="flex h-8 items-center justify-between gap-3 border-b border-warning/40 bg-canvas-soft px-3">
      <span className="text-[12px] text-text">
        Verification challenge on <span className="font-medium">{item.jobTitle}</span> @ {item.company} — resolve it
        in the browser window that opened.
      </span>
      <div className="flex shrink-0 gap-1.5">
        <Button size="sm" variant="primary" onClick={handleResume} loading={busy === 'resume'}>
          Resume
        </Button>
        <Button size="sm" variant="ghost" onClick={handleCancel} loading={busy === 'cancel'}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

export default function CaptchaAlertBanner({ pending, onRemove }: CaptchaAlertBannerProps): ReactElement | null {
  if (pending.length === 0) return null

  return (
    <div className="flex flex-col">
      {pending.map((item) => (
        <CaptchaAlertRow key={item.taskId} item={item} onRemove={onRemove} />
      ))}
    </div>
  )
}

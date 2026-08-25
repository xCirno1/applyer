import { useState, type ReactElement } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import Button from '../ui/Button'
import { useToast } from '../ui/useToast'
import { useErrorMessage } from '../../i18n/formatError'
import type { CaptchaDetectedPayload } from '@shared/types/ipcEvents'

interface CaptchaAlertBannerProps {
  pending: CaptchaDetectedPayload[]
  onRemove: (taskId: string) => void
}

function CaptchaAlertRow({ item, onRemove }: { item: CaptchaDetectedPayload; onRemove: (taskId: string) => void }): ReactElement {
  const { t } = useTranslation('board')
  const toast = useToast()
  const errorMessage = useErrorMessage()
  const [busy, setBusy] = useState<'resume' | 'cancel' | null>(null)

  const handleResume = async (): Promise<void> => {
    setBusy('resume')
    const result = await window.api.browserControl.resumeTask(item.taskId)
    setBusy(null)
    if (result.ok) {
      onRemove(item.taskId)
      toast.success(t('captcha.resuming', { title: item.jobTitle }))
    } else {
      toast.error(result.error ? errorMessage(result.error) : t('captcha.stillBlocked'))
    }
  }

  const handleCancel = async (): Promise<void> => {
    setBusy('cancel')
    const result = await window.api.browserControl.cancelTask(item.taskId)
    setBusy(null)
    if (result.ok) {
      onRemove(item.taskId)
      toast.info(t('captcha.movedToFailed', { title: item.jobTitle }))
    }
  }

  return (
    <div className="flex h-8 items-center justify-between gap-3 border-b border-warning/40 bg-canvas-soft px-3">
      <span className="text-[12px] text-text">
        {/* One of only two sentences in the app with markup inside it, so it
            goes through <Trans> rather than being split into fragments that
            would reorder wrongly in other languages. */}
        <Trans
          t={t}
          i18nKey="captcha.message"
          values={{ title: item.jobTitle, company: item.company }}
          components={{ 1: <span className="font-medium" /> }}
        />
      </span>
      <div className="flex shrink-0 gap-1.5">
        <Button size="sm" variant="primary" onClick={handleResume} loading={busy === 'resume'}>
          {t('captcha.resume')}
        </Button>
        <Button size="sm" variant="ghost" onClick={handleCancel} loading={busy === 'cancel'}>
          {t('captcha.cancel')}
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

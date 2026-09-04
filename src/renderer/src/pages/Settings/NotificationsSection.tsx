import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Checkbox from '../../components/ui/Checkbox'
import Button from '../../components/ui/Button'
import Skeleton from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/useToast'
import { useErrorMessage } from '../../i18n/formatError'
import type { NotificationPreferences, NotificationTestKind } from '@shared/types/notification'

export default function NotificationsSection(): ReactElement {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<NotificationTestKind | null>(null)
  const { t } = useTranslation('settings')
  const toast = useToast()
  const errorMessage = useErrorMessage()

  useEffect(() => {
    window.api.settings
      .getNotificationPreferences()
      .then(setPreferences)
      .catch(() => toast.error(t('notifications.loadFailed')))
  }, [t, toast])

  const update = async (patch: Partial<NotificationPreferences>): Promise<void> => {
    if (!preferences || saving || testing) return
    const previous = preferences
    const next = { ...previous, ...patch }
    setPreferences(next)
    setSaving(true)
    try {
      const result = await window.api.settings.setNotificationPreferences(next)
      if (!result.ok) {
        setPreferences(previous)
        toast.error(result.error ? errorMessage(result.error) : t('notifications.saveFailed'))
        return
      }
      setPreferences(result.preferences ?? next)
      toast.success(t('notifications.saved'))
    } catch {
      setPreferences(previous)
      toast.error(t('notifications.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const testNotification = async (kind: NotificationTestKind): Promise<void> => {
    if (testing || saving) return
    setTesting(kind)
    try {
      const result = await window.api.settings.testNotification(kind)
      if (result.ok) {
        toast.success(t('notifications.testSent'))
      } else {
        toast.error(result.error ? errorMessage(result.error) : t('notifications.testFailed'))
      }
    } catch {
      toast.error(t('notifications.testFailed'))
    } finally {
      setTesting(null)
    }
  }

  const busy = saving || testing !== null

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <div>
        <h2 className="text-[13px] font-semibold text-text">{t('notifications.title')}</h2>
        <p className="mt-0.5 text-[12px] text-text-muted">{t('notifications.intro')}</p>
      </div>

      {preferences === null ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Checkbox
            id="notifications-enabled"
            label={t('notifications.enabled')}
            hint={t('notifications.enabledHint')}
            checked={preferences.enabled}
            disabled={busy}
            onChange={(enabled) => void update({ enabled })}
          />

          <div className="flex flex-col gap-3 border-t border-border-soft pt-4">
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <Checkbox
                  id="notifications-verification"
                  label={t('notifications.verificationRequired')}
                  hint={t('notifications.verificationRequiredHint')}
                  checked={preferences.verificationRequired}
                  disabled={busy || !preferences.enabled}
                  onChange={(verificationRequired) => void update({ verificationRequired })}
                />
              </div>
              <Button
                size="sm"
                variant="secondary"
                loading={testing === 'verificationRequired'}
                disabled={busy || !preferences.enabled || !preferences.verificationRequired}
                onClick={() => void testNotification('verificationRequired')}
              >
                {t('notifications.sendTest')}
              </Button>
            </div>
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <Checkbox
                  id="notifications-filled"
                  label={t('notifications.jobFilled')}
                  hint={t('notifications.jobFilledHint')}
                  checked={preferences.jobFilled}
                  disabled={busy || !preferences.enabled}
                  onChange={(jobFilled) => void update({ jobFilled })}
                />
              </div>
              <Button
                size="sm"
                variant="secondary"
                loading={testing === 'jobFilled'}
                disabled={busy || !preferences.enabled || !preferences.jobFilled}
                onClick={() => void testNotification('jobFilled')}
              >
                {t('notifications.sendTest')}
              </Button>
            </div>
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <Checkbox
                  id="notifications-failed"
                  label={t('notifications.jobFailed')}
                  hint={t('notifications.jobFailedHint')}
                  checked={preferences.jobFailed}
                  disabled={busy || !preferences.enabled}
                  onChange={(jobFailed) => void update({ jobFailed })}
                />
              </div>
              <Button
                size="sm"
                variant="secondary"
                loading={testing === 'jobFailed'}
                disabled={busy || !preferences.enabled || !preferences.jobFailed}
                onClick={() => void testNotification('jobFailed')}
              >
                {t('notifications.sendTest')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

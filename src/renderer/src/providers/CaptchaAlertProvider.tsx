import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import CaptchaAlertBanner from '../components/board/CaptchaAlertBanner'
import { CaptchaAlertContext } from './CaptchaAlertContext'
import type { CaptchaDetectedPayload } from '@shared/types/ipcEvents'

export default function CaptchaAlertProvider({ children }: { children: ReactNode }): ReactElement {
  const [pending, setPending] = useState<CaptchaDetectedPayload[]>([])

  useEffect(() => {
    const offDetected = window.api.browserControl.onCaptchaDetected((payload) => {
      setPending((prev) => (prev.some((p) => p.taskId === payload.taskId) ? prev : [...prev, payload]))
    })
    const offResolved = window.api.browserControl.onCaptchaResolved(({ taskId }) => {
      setPending((prev) => prev.filter((p) => p.taskId !== taskId))
    })
    return () => {
      offDetected()
      offResolved()
    }
  }, [])

  const removeEntry = useCallback((taskId: string) => {
    setPending((prev) => prev.filter((p) => p.taskId !== taskId))
  }, [])

  const blockedJobIds = useMemo(() => new Set(pending.map((p) => p.jobId)), [pending])

  return (
    <CaptchaAlertContext.Provider value={{ blockedJobIds, pending }}>
      <CaptchaAlertBanner pending={pending} onRemove={removeEntry} />
      {children}
    </CaptchaAlertContext.Provider>
  )
}

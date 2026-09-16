import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import CaptchaAlertBanner from '../components/board/CaptchaAlertBanner'
import { CaptchaAlertContext } from './CaptchaAlertContext'
import type { CaptchaDetectedPayload, SearchChallengePayload } from '@shared/types/ipcEvents'

// Subscribes to the captcha:detected/captcha:resolved IPC pushes (and their
// search-challenge siblings, for a job search a site refused to answer
// headless and that is now waiting in the application browser), renders
// `CaptchaAlertBanner`, and exposes both which job ids are currently blocked
// (`useBlockedJobIds`, so `JobCard` can show a "needs verification" tag) and
// the full pending payload list (`usePendingCaptchaAlerts`, so
// `PipelineOverview` can render title/company without depending on which
// page of a column happens to be loaded) — see CaptchaAlertContext.ts for
// those two hooks. Wraps `<main>` in App.tsx's main shell.

export default function CaptchaAlertProvider({ children }: { children: ReactNode }): ReactElement {
  const [pending, setPending] = useState<CaptchaDetectedPayload[]>([])
  const [pendingSearches, setPendingSearches] = useState<SearchChallengePayload[]>([])

  useEffect(() => {
    const offDetected = window.api.browserControl.onCaptchaDetected((payload) => {
      setPending((prev) => (prev.some((p) => p.taskId === payload.taskId) ? prev : [...prev, payload]))
    })
    const offResolved = window.api.browserControl.onCaptchaResolved(({ taskId }) => {
      setPending((prev) => prev.filter((p) => p.taskId !== taskId))
    })
    const offSearchDetected = window.api.browserControl.onSearchChallengeDetected((payload) => {
      setPendingSearches((prev) => (prev.some((p) => p.taskId === payload.taskId) ? prev : [...prev, payload]))
    })
    const offSearchResolved = window.api.browserControl.onSearchChallengeResolved(({ taskId }) => {
      setPendingSearches((prev) => prev.filter((p) => p.taskId !== taskId))
    })
    return () => {
      offDetected()
      offResolved()
      offSearchDetected()
      offSearchResolved()
    }
  }, [])

  const removeEntry = useCallback((taskId: string) => {
    setPending((prev) => prev.filter((p) => p.taskId !== taskId))
    setPendingSearches((prev) => prev.filter((p) => p.taskId !== taskId))
  }, [])

  const blockedJobIds = useMemo(() => new Set(pending.map((p) => p.jobId)), [pending])

  return (
    <CaptchaAlertContext.Provider value={{ blockedJobIds, pending, pendingSearches }}>
      <CaptchaAlertBanner pending={pending} pendingSearches={pendingSearches} onRemove={removeEntry} />
      {children}
    </CaptchaAlertContext.Provider>
  )
}

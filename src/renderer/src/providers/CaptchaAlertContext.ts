import { createContext, useContext } from 'react'
import type { CaptchaDetectedPayload, SearchChallengePayload } from '@shared/types/ipcEvents'

// Context split into its own file so CaptchaAlertProvider.tsx stays a
// component-only export (required for Fast Refresh) — see that file's doc
// comment for what actually populates this value.

export interface CaptchaAlertContextValue {
  blockedJobIds: Set<string>
  pending: CaptchaDetectedPayload[]
  /** Searches waiting on a site's challenge in the application browser; no job to point at, so only the banner shows them. */
  pendingSearches: SearchChallengePayload[]
}

export const CaptchaAlertContext = createContext<CaptchaAlertContextValue>({
  blockedJobIds: new Set(),
  pending: [],
  pendingSearches: []
})

export function useBlockedJobIds(): Set<string> {
  return useContext(CaptchaAlertContext).blockedJobIds
}

export function usePendingCaptchaAlerts(): CaptchaDetectedPayload[] {
  return useContext(CaptchaAlertContext).pending
}

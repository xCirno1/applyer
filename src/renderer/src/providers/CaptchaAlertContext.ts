import { createContext, useContext } from 'react'
import type { CaptchaDetectedPayload } from '@shared/types/ipcEvents'

// Context split into its own file so CaptchaAlertProvider.tsx stays a
// component-only export (required for Fast Refresh) — see that file's doc
// comment for what actually populates this value.

export interface CaptchaAlertContextValue {
  blockedJobIds: Set<string>
  pending: CaptchaDetectedPayload[]
}

export const CaptchaAlertContext = createContext<CaptchaAlertContextValue>({
  blockedJobIds: new Set(),
  pending: []
})

export function useBlockedJobIds(): Set<string> {
  return useContext(CaptchaAlertContext).blockedJobIds
}

export function usePendingCaptchaAlerts(): CaptchaDetectedPayload[] {
  return useContext(CaptchaAlertContext).pending
}

import { createContext, useContext } from 'react'
import type { CaptchaDetectedPayload } from '@shared/types/ipcEvents'

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

import { createContext, useContext } from 'react'

export interface CaptchaAlertContextValue {
  blockedJobIds: Set<string>
}

export const CaptchaAlertContext = createContext<CaptchaAlertContextValue>({ blockedJobIds: new Set() })

export function useBlockedJobIds(): Set<string> {
  return useContext(CaptchaAlertContext).blockedJobIds
}

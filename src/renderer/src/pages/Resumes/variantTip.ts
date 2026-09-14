// The "ask the agent to write a variant" tip under the variant list can be
// closed for good. Like `resumesLayout.ts` the flag lives in localStorage:
// a tip the user dismissed should not come back on the next launch, and
// nothing else needs to know about it, so it is not a setting in main.

export const VARIANT_TIP_STORAGE_KEY = 'resumes:variantTipDismissed:v1'

export function readVariantTipDismissed(): boolean {
  try {
    return window.localStorage.getItem(VARIANT_TIP_STORAGE_KEY) === '1'
  } catch {
    // Disabled storage: showing the tip again is the harmless outcome.
    return false
  }
}

export function writeVariantTipDismissed(): void {
  try {
    window.localStorage.setItem(VARIANT_TIP_STORAGE_KEY, '1')
  } catch {
    // Same reasoning as the read: the tip closes for this session anyway.
  }
}

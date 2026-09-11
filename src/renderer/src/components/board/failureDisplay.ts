export type FailureLabelKey =
  | 'failure.tags.captchaVerification'
  | 'failure.tags.loginRequired'
  | 'failure.tags.formNotSupported'
  | 'failure.tags.expiredListing'
  | 'failure.tags.duplicate'
  | 'failure.tags.interrupted'
  | 'failure.tags.browserUnavailable'
  | 'failure.tags.other'

export type FailureMessageKey =
  | 'failure.messages.captchaVerification'
  | 'failure.messages.loginRequired'
  | 'failure.messages.formNotSupported'
  | 'failure.messages.expiredListing'
  | 'failure.messages.duplicate'
  | 'failure.messages.interrupted'
  | 'failure.messages.browserUnavailable'
  | 'failure.messages.browserUnavailableDetail'
  | 'failure.messages.formOpenFailedDetail'
  | 'failure.messages.formFillFailedDetail'
  | 'failure.messages.jobNotFound'

interface FailureMessageDisplay {
  key: FailureMessageKey | null
  params?: { detail: string }
  raw: string | null
}

const LABEL_KEYS: Record<string, FailureLabelKey> = {
  captcha_verification: 'failure.tags.captchaVerification',
  login_required: 'failure.tags.loginRequired',
  form_not_supported: 'failure.tags.formNotSupported',
  expired_listing: 'failure.tags.expiredListing',
  duplicate: 'failure.tags.duplicate',
  interrupted: 'failure.tags.interrupted',
  browser_unavailable: 'failure.tags.browserUnavailable',
  other: 'failure.tags.other'
}

const MESSAGE_KEYS: Partial<Record<string, FailureMessageKey>> = {
  captcha_verification: 'failure.messages.captchaVerification',
  login_required: 'failure.messages.loginRequired',
  form_not_supported: 'failure.messages.formNotSupported',
  expired_listing: 'failure.messages.expiredListing',
  duplicate: 'failure.messages.duplicate',
  interrupted: 'failure.messages.interrupted',
  browser_unavailable: 'failure.messages.browserUnavailable'
}

const DETAIL_PREFIXES: { tag: string; prefix: string; key: FailureMessageKey }[] = [
  {
    tag: 'browser_unavailable',
    prefix: "Couldn't prepare a browser:",
    key: 'failure.messages.browserUnavailableDetail'
  },
  {
    tag: 'form_not_supported',
    prefix: 'Failed to open the application page:',
    key: 'failure.messages.formOpenFailedDetail'
  },
  {
    tag: 'other',
    prefix: 'Failed while filling the form:',
    key: 'failure.messages.formFillFailedDetail'
  }
]

export function humanizeFailureTag(tag: string): string {
  return tag.replace(/_/g, ' ')
}

export function failureLabelKey(tag: string): FailureLabelKey | null {
  return LABEL_KEYS[tag] ?? null
}

/**
 * Maps messages produced by Applyer's own automation to translation keys.
 * Unknown/custom agent messages stay verbatim so translating never discards
 * a diagnostic we do not understand.
 */
export function failureMessageDisplay(tag: string, message: string | null): FailureMessageDisplay {
  if (!message) return { key: null, raw: null }

  const prefixed = DETAIL_PREFIXES.find((candidate) => candidate.tag === tag && message.startsWith(candidate.prefix))
  if (prefixed) {
    const detail = message.slice(prefixed.prefix.length).trim()
    return detail ? { key: prefixed.key, params: { detail }, raw: null } : { key: MESSAGE_KEYS[tag] ?? null, raw: null }
  }

  if (tag === 'other' && message === 'Job not found.') {
    return { key: 'failure.messages.jobNotFound', raw: null }
  }

  const key = MESSAGE_KEYS[tag]
  return key ? { key, raw: null } : { key: null, raw: message }
}

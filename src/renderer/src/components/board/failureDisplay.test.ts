import { describe, expect, it } from 'vitest'
import { failureLabelKey, failureMessageDisplay, humanizeFailureTag } from './failureDisplay'

describe('failure display', () => {
  it('maps built-in tags to localized labels and humanizes custom tags', () => {
    expect(failureLabelKey('form_not_supported')).toBe('failure.tags.formNotSupported')
    expect(failureLabelKey('interrupted')).toBe('failure.tags.interrupted')
    expect(failureLabelKey('custom_agent_reason')).toBeNull()
    expect(humanizeFailureTag('custom_agent_reason')).toBe('custom agent reason')
  })

  it('maps standard generated messages to localized descriptions', () => {
    expect(
      failureMessageDisplay(
        'form_not_supported',
        "Couldn't identify any recognizable fields on this application form. It may need to be filled manually."
      )
    ).toEqual({ key: 'failure.messages.formNotSupported', raw: null })
    expect(
      failureMessageDisplay(
        'captcha_verification',
        'The verification challenge was not resolved in time (or was cancelled).'
      )
    ).toEqual({ key: 'failure.messages.captchaVerification', raw: null })
  })

  it('translates known prefixes while preserving their diagnostic detail', () => {
    expect(failureMessageDisplay('browser_unavailable', "Couldn't prepare a browser: executable missing"))
      .toEqual({
        key: 'failure.messages.browserUnavailableDetail',
        params: { detail: 'executable missing' },
        raw: null
      })
    expect(failureMessageDisplay('other', 'Failed while filling the form: detached frame')).toEqual({
      key: 'failure.messages.formFillFailedDetail',
      params: { detail: 'detached frame' },
      raw: null
    })
  })

  it('keeps unknown and custom messages verbatim', () => {
    expect(failureMessageDisplay('custom_agent_reason', 'Employer requires an assessment')).toEqual({
      key: null,
      raw: 'Employer requires an assessment'
    })
    expect(failureMessageDisplay('other', 'Unexpected custom diagnostic')).toEqual({
      key: null,
      raw: 'Unexpected custom diagnostic'
    })
  })

  it('renders no description when none was stored', () => {
    expect(failureMessageDisplay('form_not_supported', null)).toEqual({ key: null, raw: null })
  })
})

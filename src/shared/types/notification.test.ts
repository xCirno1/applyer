import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  isNotificationPreferences,
  isNotificationTestKind,
  isNotificationLocale
} from './notification'

describe('isNotificationPreferences', () => {
  it('accepts the complete boolean preference shape', () => {
    expect(isNotificationPreferences(DEFAULT_NOTIFICATION_PREFERENCES)).toBe(true)
  })

  it('rejects malformed and partial values', () => {
    expect(isNotificationPreferences(null)).toBe(false)
    expect(isNotificationPreferences({ enabled: true })).toBe(false)
    expect(isNotificationPreferences({ ...DEFAULT_NOTIFICATION_PREFERENCES, jobFailed: 'yes' })).toBe(false)
  })
})

describe('isNotificationTestKind', () => {
  it('accepts only the three supported test notification categories', () => {
    expect(isNotificationTestKind('verificationRequired')).toBe(true)
    expect(isNotificationTestKind('jobFilled')).toBe(true)
    expect(isNotificationTestKind('jobFailed')).toBe(true)
    expect(isNotificationTestKind('submitted')).toBe(false)
    expect(isNotificationTestKind(null)).toBe(false)
  })
})

describe('isNotificationLocale', () => {
  it('accepts supported locales only', () => {
    expect(isNotificationLocale('en')).toBe(true)
    expect(isNotificationLocale('id')).toBe(true)
    expect(isNotificationLocale('en-AU')).toBe(false)
    expect(isNotificationLocale('system')).toBe(false)
  })
})

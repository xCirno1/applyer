import { describe, it, expect } from 'vitest'
import { authUiPhase, canStartConnect, canSubmitAuthCode, formatUsd, remainingCredits } from './openRouterConnectLogic'
import type { OpenRouterConnection } from '@shared/types/openrouter'

describe('authUiPhase', () => {
  it('maps waiting to a waiting phase carrying the auth URL', () => {
    expect(authUiPhase({ state: 'waiting', authUrl: 'https://x', startedAt: '2026-01-01T00:00:00Z' })).toEqual({
      phase: 'waiting',
      authUrl: 'https://x'
    })
  })

  it('maps exchanging straight through', () => {
    expect(authUiPhase({ state: 'exchanging' })).toEqual({ phase: 'exchanging' })
  })

  it('maps failed carrying the error', () => {
    const error = { code: 'openrouterAuthFailed' as const, params: { message: 'nope' } }
    expect(authUiPhase({ state: 'failed', error })).toEqual({ phase: 'failed', error })
  })

  it('folds idle and connected into idle, since connected is shown via the reloaded connection instead', () => {
    expect(authUiPhase({ state: 'idle' })).toEqual({ phase: 'idle' })
    expect(authUiPhase({ state: 'connected' })).toEqual({ phase: 'idle' })
  })
})

describe('canStartConnect', () => {
  const connectedFalse: OpenRouterConnection = { connected: false, keychainAvailable: true }
  const connectedTrue: OpenRouterConnection = {
    connected: true,
    keyRejected: false,
    keychainAvailable: true,
    storedPlaintext: false,
    keyInfo: null,
    credits: null,
    refreshError: null
  }
  const noKeychain: OpenRouterConnection = { connected: false, keychainAvailable: false }

  it('is false while the connection has not loaded yet', () => {
    expect(canStartConnect(null, false)).toBe(false)
  })

  it('is false once already connected', () => {
    expect(canStartConnect(connectedTrue, false)).toBe(false)
  })

  it('is true when a keychain is available and not connected', () => {
    expect(canStartConnect(connectedFalse, false)).toBe(true)
  })

  it('requires the plaintext acknowledgement when no keychain is available', () => {
    expect(canStartConnect(noKeychain, false)).toBe(false)
    expect(canStartConnect(noKeychain, true)).toBe(true)
  })
})

describe('canSubmitAuthCode', () => {
  it('rejects empty or whitespace-only input', () => {
    expect(canSubmitAuthCode('')).toBe(false)
    expect(canSubmitAuthCode('   ')).toBe(false)
  })

  it('accepts a real value', () => {
    expect(canSubmitAuthCode('abc123')).toBe(true)
  })
})

describe('formatUsd', () => {
  it('formats to 2 decimals', () => {
    expect(formatUsd(12.3, 'en-US')).toBe('$12.30')
  })

  it('falls back for a non-finite amount', () => {
    expect(formatUsd(Number.NaN, 'en-US')).toBe('$0.00')
  })
})

describe('remainingCredits', () => {
  it('subtracts usage from the total', () => {
    expect(remainingCredits(100, 40)).toBe(60)
  })

  it('floors at 0 rather than going negative', () => {
    expect(remainingCredits(10, 25)).toBe(0)
  })

  it('floors a non-finite result at 0 too', () => {
    expect(remainingCredits(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)).toBe(0)
  })
})

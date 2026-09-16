/*
 * Plain-module logic behind `OpenRouterConnectCard`: what the pushed
 * `OpenRouterAuthStatus` means for the card's own UI phase, and whether the
 * Connect button may be pressed at all. No React, no DOM, same split as
 * `workspace/workspaceLayout.ts` vs `useWorkspaceLayout.ts`.
 */
import type { AppError } from '@shared/types/errorCodes'
import type { OpenRouterAuthStatus, OpenRouterConnection } from '@shared/types/openrouter'

export type AuthUiPhase =
  | { phase: 'idle' }
  | { phase: 'waiting'; authUrl: string }
  | { phase: 'exchanging' }
  | { phase: 'failed'; error: AppError }

/**
 * Maps the pushed status onto the card's own phase. `'connected'` is
 * deliberately folded into `'idle'`: the card doesn't render a "connected"
 * phase of its own, it reloads `OpenRouterConnection` and renders that
 * instead, so the auth flow's UI just gets out of the way.
 */
export function authUiPhase(status: OpenRouterAuthStatus): AuthUiPhase {
  switch (status.state) {
    case 'waiting':
      return { phase: 'waiting', authUrl: status.authUrl }
    case 'exchanging':
      return { phase: 'exchanging' }
    case 'failed':
      return { phase: 'failed', error: status.error }
    case 'idle':
    case 'connected':
    default:
      return { phase: 'idle' }
  }
}

/**
 * Whether the Connect button may be pressed. A connection that isn't loaded
 * yet, or is already connected with a working key, has nothing to connect;
 * a stored key OpenRouter has rejected is the exception, since the only
 * way out is a fresh key. One that has no OS keychain needs the explicit
 * plaintext-storage acknowledgement first: that is the one thing the
 * checkbox in the UI actually gates.
 */
export function canStartConnect(connection: OpenRouterConnection | null, allowPlaintextKey: boolean): boolean {
  if (!connection) return false
  if (connection.connected && !connection.keyRejected) return false
  if (!connection.keychainAvailable && !allowPlaintextKey) return false
  return true
}

/** Trims and rejects an empty paste, the one thing worth checking before sending it to main. */
export function canSubmitAuthCode(value: string): boolean {
  return value.trim().length > 0
}

/**
 * "$12.34" for a key's usage/limit or the account's credits. Always USD
 * (see `formatPricePerMillion` for why this never uses `Intl`'s currency
 * style), fixed at 2 decimals since these are real dollar amounts rather
 * than the sub-cent per-token prices `formatPricePerMillion` handles.
 */
export function formatUsd(amount: number, locale: string): string {
  if (!Number.isFinite(amount)) return '$0.00'
  try {
    return `$${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`
  } catch {
    return `$${amount.toFixed(2)}`
  }
}

/**
 * Credits remaining is derived, not stored: total granted minus total
 * spent, floored at 0 so a race between a spend and a top-up (or a
 * malformed pair from the API) never reads as negative money.
 */
export function remainingCredits(totalCredits: number, totalUsage: number): number {
  const remaining = totalCredits - totalUsage
  return Number.isFinite(remaining) && remaining > 0 ? remaining : 0
}

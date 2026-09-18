import { isAppError, type AppError } from './errorCodes'

/**
 * The OpenRouter agent mode: the user authorizes Applyer via OpenRouter's
 * OAuth PKCE flow (no API key ever typed by hand), picks a tool-capable
 * model from OpenRouter's catalog, and chats with an in-app agent that calls
 * the same MCP tools the CLI mode's terminal agent calls, in-process rather
 * than over stdio.
 *
 * Everything here is renderer-trusted, IPC-boundary data: settings come back
 * from main (or a persisted/imported value main only partially trusts
 * itself), the model catalog is OpenRouter's own API response relayed
 * through main, and the auth status is pushed live while a browser-based
 * OAuth exchange is in flight. Every shape gets a lenient guard: malformed
 * input degrades to a default rather than throwing or rendering garbage.
 */

export const OPENROUTER_DEFAULT_MODEL_ID = 'deepseek/deepseek-v4.1-flash'

/** 'default' means: do not send a `reasoning` parameter at all, letting the model use its own defaults. */
export type ReasoningEffort = 'default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

const REASONING_EFFORTS: ReadonlySet<ReasoningEffort> = new Set([
  'default',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
])

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && REASONING_EFFORTS.has(value as ReasoningEffort)
}

export interface ToolApprovalPolicy {
  /** MCP tool names that need an inline Allow/Deny in chat before running. */
  askFor: string[]
}

export interface OpenRouterSettings {
  modelId: string
  reasoningEffort: ReasoningEffort
  toolApproval: ToolApprovalPolicy
}

export const DEFAULT_TOOL_APPROVAL_ASK_FOR: readonly string[] = [
  'queue_job',
  'exclude_job',
  'update_profile',
  'set_master_resume',
  'save_resume_variant',
  'delete_resume_variant',
  'assign_resume',
  'flag_failure',
  'add_company_board'
]

export const DEFAULT_OPENROUTER_SETTINGS: OpenRouterSettings = {
  modelId: OPENROUTER_DEFAULT_MODEL_ID,
  reasoningEffort: 'default',
  toolApproval: { askFor: [...DEFAULT_TOOL_APPROVAL_ASK_FOR] }
}

/** MCP tool names are short identifiers; this only bounds a persisted/imported value against being replayed as an arbitrarily large string. */
const TOOL_NAME_MAX_LENGTH = 200
/** Bounds how many tool names a policy can carry, so a corrupted persisted value degrades to a capped list rather than an unbounded one. */
const TOOL_APPROVAL_MAX_ENTRIES = 100

function isToolApprovalPolicyShape(value: unknown): value is ToolApprovalPolicy {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ToolApprovalPolicy>
  return Array.isArray(candidate.askFor) && candidate.askFor.every((item) => typeof item === 'string')
}

/**
 * Dedupes and trims tool names, dropping anything that isn't a non-empty
 * (and not absurdly long) string. Falls back to the default ask-for list
 * only when the whole value is unreadable, not when it legitimately parses
 * to an empty list (the user unchecked every tool), same "fall back field
 * by field, not wholesale" shape as `getResumeSettings`.
 */
export function normalizeToolApproval(value: unknown): ToolApprovalPolicy {
  const askFor = value && typeof value === 'object' ? (value as { askFor?: unknown }).askFor : undefined
  if (!Array.isArray(askFor)) return { askFor: [...DEFAULT_TOOL_APPROVAL_ASK_FOR] }
  const seen = new Set<string>()
  for (const item of askFor) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (trimmed.length === 0 || trimmed.length > TOOL_NAME_MAX_LENGTH) continue
    seen.add(trimmed)
    if (seen.size >= TOOL_APPROVAL_MAX_ENTRIES) break
  }
  return { askFor: [...seen] }
}

/** Strict runtime guard: every field must already be well-formed. Use `parseOpenRouterSettings` for a lenient, per-field fallback instead. */
export function isOpenRouterSettings(value: unknown): value is OpenRouterSettings {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<OpenRouterSettings>
  return (
    typeof candidate.modelId === 'string' &&
    candidate.modelId.trim().length > 0 &&
    isReasoningEffort(candidate.reasoningEffort) &&
    isToolApprovalPolicyShape(candidate.toolApproval)
  )
}

/** Lenient parse for a persisted or imported value: each field falls back to its default independently rather than discarding the whole record. */
export function parseOpenRouterSettings(value: unknown): OpenRouterSettings {
  const candidate = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const modelId =
    typeof candidate.modelId === 'string' && candidate.modelId.trim().length > 0
      ? candidate.modelId.trim()
      : DEFAULT_OPENROUTER_SETTINGS.modelId
  const reasoningEffort = isReasoningEffort(candidate.reasoningEffort)
    ? candidate.reasoningEffort
    : DEFAULT_OPENROUTER_SETTINGS.reasoningEffort
  return { modelId, reasoningEffort, toolApproval: normalizeToolApproval(candidate.toolApproval) }
}

export interface OpenRouterModel {
  id: string
  name: string
  description: string
  contextLength: number
  /** USD per 1M tokens, null when unknown/variable */
  promptPricePerMillion: number | null
  completionPricePerMillion: number | null
  supportsTools: boolean
  supportsReasoning: boolean
  reasoningEfforts: ReasoningEffort[]
  inputModalities: string[]
  createdAt: number | null
  isFree: boolean
}

export function isOpenRouterModel(value: unknown): value is OpenRouterModel {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<OpenRouterModel>
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.name === 'string' &&
    typeof candidate.description === 'string' &&
    typeof candidate.contextLength === 'number' &&
    Number.isFinite(candidate.contextLength) &&
    (candidate.promptPricePerMillion === null || typeof candidate.promptPricePerMillion === 'number') &&
    (candidate.completionPricePerMillion === null || typeof candidate.completionPricePerMillion === 'number') &&
    typeof candidate.supportsTools === 'boolean' &&
    typeof candidate.supportsReasoning === 'boolean' &&
    Array.isArray(candidate.reasoningEfforts) &&
    candidate.reasoningEfforts.every(isReasoningEffort) &&
    Array.isArray(candidate.inputModalities) &&
    candidate.inputModalities.every((modality) => typeof modality === 'string') &&
    (candidate.createdAt === null || typeof candidate.createdAt === 'number') &&
    typeof candidate.isFree === 'boolean'
  )
}

export interface OpenRouterModelCatalog {
  models: OpenRouterModel[]
  /** ISO timestamp of when this catalog was fetched from OpenRouter. */
  fetchedAt: string
  /** True when this is a cached catalog served after a live refresh failed. */
  stale: boolean
}

export interface OpenRouterKeyInfo {
  label: string | null
  /** USD credit limit on the key, null = unlimited */
  limit: number | null
  usage: number
  isFreeTier: boolean
  /** sha256 hex of the key, for openrouter.ai/keys/<hash> and logs deep links */
  keyHash: string
}

export interface OpenRouterCredits {
  totalCredits: number
  totalUsage: number
}

export type OpenRouterConnection =
  | { connected: false; keychainAvailable: boolean }
  | {
      connected: true
      keychainAvailable: boolean
      storedPlaintext: boolean
      keyInfo: OpenRouterKeyInfo | null
      credits: OpenRouterCredits | null
      /** why keyInfo/credits are null, if a refresh failed */
      refreshError: AppError | null
      /**
       * OpenRouter answered 401 for the stored key (deleted or expired on
       * their side). Still `connected: true` because a key *is* stored and
       * Disconnect has to be offered for it; the UI treats it as unusable
       * and offers Reconnect, which replaces the key in place.
       */
      keyRejected: boolean
    }

/**
 * Claude-Code-style device auth: the browser opens automatically to
 * OpenRouter's PKCE consent screen, the same URL is shown so it can be
 * copied if the browser didn't open (a remote/headless machine), and a paste
 * field accepts the callback code directly in case the loopback redirect
 * never lands (a firewall, a browser that opened somewhere else).
 */
export type OpenRouterAuthStatus =
  | { state: 'idle' }
  | { state: 'waiting'; authUrl: string; startedAt: string }
  | { state: 'exchanging' }
  | { state: 'connected' }
  | { state: 'failed'; error: AppError }

export interface StartOpenRouterAuthOptions {
  /** Only honoured when no OS keychain is available; the renderer must show an explicit warning and checkbox. */
  allowPlaintextKey?: boolean
}

export function isOpenRouterAuthStatus(value: unknown): value is OpenRouterAuthStatus {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { state?: unknown }
  switch (candidate.state) {
    case 'idle':
    case 'exchanging':
    case 'connected':
      return true
    case 'waiting': {
      const waiting = value as { authUrl?: unknown; startedAt?: unknown }
      return (
        typeof waiting.authUrl === 'string' &&
        waiting.authUrl.length > 0 &&
        typeof waiting.startedAt === 'string' &&
        waiting.startedAt.length > 0
      )
    }
    case 'failed': {
      const failed = value as { error?: unknown }
      return isAppError(failed.error)
    }
    default:
      return false
  }
}

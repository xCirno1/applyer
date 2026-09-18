import { appError, type AppError } from '@shared/types/errorCodes'
import { isReasoningEffort, type OpenRouterCredits, type OpenRouterKeyInfo, type OpenRouterModel } from '@shared/types/openrouter'
import { appLogger } from '../logger'
import { sha256Hex } from './pkce'

/**
 * The plain request/response layer for OpenRouter's REST API (everything
 * that isn't the chat-completions stream, which lives in `streamChat.ts`
 * because it needs an incremental SSE parser rather than one JSON body).
 *
 * Every function here returns a result value rather than throwing, and
 * every response body is treated as untrusted: OpenRouter is a third party,
 * its API can change shape under us, and a network intermediary can hand
 * back anything at all. A response that doesn't parse into the shape we
 * expect is logged and turned into `openrouterRequestFailed` rather than
 * letting a `TypeError` from a missing field reach the IPC boundary as an
 * unhandled rejection.
 *
 * `fetch` is a parameter (defaulting to the global) purely so tests can
 * inject a fake implementation without a network double.
 */

export type FetchLike = typeof fetch

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: AppError }

export const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1'
const REQUEST_TIMEOUT_MS = 20000

/** Applyer has no client secret (a downloaded desktop app can't keep one), so every request identifies itself the same way OpenRouter's own docs recommend. */
export function openRouterHeaders(apiKey: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'HTTP-Referer': 'https://github.com/xCirno1/applyer',
    'X-Title': 'Applyer'
  }
  if (apiKey !== null) headers.Authorization = `Bearer ${apiKey}`
  return headers
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Bounded preview of a malformed body for the log line, never the whole thing (it could be arbitrarily large or contain a stray secret echoed back). */
function preview(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 300)
  } catch {
    return String(value).slice(0, 300)
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const text = await response.text()
    if (!text) return response.statusText || `HTTP ${response.status}`
    try {
      const parsed: unknown = JSON.parse(text)
      if (isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.message === 'string') {
        return parsed.error.message
      }
    } catch {
      // Not JSON; fall through to the raw text below.
    }
    return text.slice(0, 500)
  } catch (err) {
    return err instanceof Error ? err.message : (response.statusText || `HTTP ${response.status}`)
  }
}

/**
 * Shared HTTP status mapping (`streamChat.ts` reuses this for the same
 * codes on the streaming endpoint). `modelId` is only supplied by callers
 * that are asking about one specific model (the chat-completions request);
 * without it, a 404/model-flavoured 400 falls through to the generic
 * request-failed error instead of naming a model that was never in play.
 */
export function mapOpenRouterHttpError(status: number, message: string, modelId?: string): AppError {
  // Every caller here sends a stored key, so a 401 is that key being
  // refused (deleted or expired on OpenRouter's side), not "no key yet".
  if (status === 401) return appError('openrouterKeyRejected')
  if (status === 402) return appError('openrouterInsufficientCredits')
  if (status === 429) return appError('openrouterRateLimited')
  if (modelId && (status === 404 || (status === 400 && message.toLowerCase().includes('model')))) {
    return appError('openrouterModelUnavailable', { modelId })
  }
  return appError('openrouterRequestFailed', { status, message })
}

function networkError(err: unknown): AppError {
  return appError('openrouterRequestFailed', { status: 0, message: err instanceof Error ? err.message : String(err) })
}

async function requestJson(
  url: string,
  init: RequestInit,
  fetchImpl: FetchLike
): Promise<ApiResult<{ status: number; body: unknown }>> {
  let response: Response
  try {
    response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch (err) {
    return { ok: false, error: networkError(err) }
  }
  if (!response.ok) {
    const message = await readErrorMessage(response)
    return { ok: false, error: mapOpenRouterHttpError(response.status, message) }
  }
  try {
    const body: unknown = await response.json()
    return { ok: true, value: { status: response.status, body } }
  } catch (err) {
    appLogger.warn(`OpenRouter response for ${url} was not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
    return {
      ok: false,
      error: appError('openrouterRequestFailed', { status: response.status, message: 'The response was not valid JSON.' })
    }
  }
}

export async function fetchKeyInfo(key: string, fetchImpl: FetchLike = fetch): Promise<ApiResult<OpenRouterKeyInfo>> {
  const result = await requestJson(`${OPENROUTER_API_BASE}/auth/key`, { headers: openRouterHeaders(key) }, fetchImpl)
  if (!result.ok) return result
  const data = isRecord(result.value.body) ? result.value.body.data : undefined
  if (!isRecord(data)) {
    appLogger.warn(`OpenRouter key info response was malformed: ${preview(result.value.body)}`)
    return { ok: false, error: appError('openrouterRequestFailed', { status: result.value.status, message: 'Malformed key info response.' }) }
  }
  return {
    ok: true,
    value: {
      label: typeof data.label === 'string' ? data.label : null,
      limit: typeof data.limit === 'number' && Number.isFinite(data.limit) ? data.limit : null,
      usage: typeof data.usage === 'number' && Number.isFinite(data.usage) ? data.usage : 0,
      isFreeTier: typeof data.is_free_tier === 'boolean' ? data.is_free_tier : false,
      keyHash: sha256Hex(key)
    }
  }
}

export async function fetchCredits(key: string, fetchImpl: FetchLike = fetch): Promise<ApiResult<OpenRouterCredits>> {
  const result = await requestJson(`${OPENROUTER_API_BASE}/credits`, { headers: openRouterHeaders(key) }, fetchImpl)
  if (!result.ok) return result
  const data = isRecord(result.value.body) ? result.value.body.data : undefined
  if (!isRecord(data) || typeof data.total_credits !== 'number' || typeof data.total_usage !== 'number') {
    appLogger.warn(`OpenRouter credits response was malformed: ${preview(result.value.body)}`)
    return { ok: false, error: appError('openrouterRequestFailed', { status: result.value.status, message: 'Malformed credits response.' }) }
  }
  return { ok: true, value: { totalCredits: data.total_credits, totalUsage: data.total_usage } }
}

/** USD-per-token string (or missing/non-numeric) to USD-per-million-tokens, null when it can't be parsed. */
function pricePerMillion(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const perToken = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(perToken) ? perToken * 1_000_000 : null
}

function mapModel(raw: unknown): OpenRouterModel | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id.length === 0) return null

  const architecture = isRecord(raw.architecture) ? raw.architecture : {}
  const pricing = isRecord(raw.pricing) ? raw.pricing : {}
  const reasoning = isRecord(raw.reasoning) ? raw.reasoning : {}

  const supportedParameters = Array.isArray(raw.supported_parameters)
    ? raw.supported_parameters.filter((entry): entry is string => typeof entry === 'string')
    : []
  const rawEfforts = Array.isArray(reasoning.supported_efforts)
    ? reasoning.supported_efforts.filter((entry): entry is string => typeof entry === 'string')
    : []
  const reasoningEfforts = rawEfforts.filter(isReasoningEffort)

  const promptPricePerMillion = pricePerMillion(pricing.prompt)
  const completionPricePerMillion = pricePerMillion(pricing.completion)

  return {
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : raw.id,
    description: typeof raw.description === 'string' ? raw.description : '',
    contextLength:
      typeof raw.context_length === 'number' && Number.isFinite(raw.context_length) ? raw.context_length : 0,
    promptPricePerMillion,
    completionPricePerMillion,
    supportsTools: supportedParameters.includes('tools'),
    supportsReasoning: supportedParameters.includes('reasoning') || reasoningEfforts.length > 0,
    reasoningEfforts,
    inputModalities: Array.isArray(architecture.input_modalities)
      ? architecture.input_modalities.filter((entry): entry is string => typeof entry === 'string')
      : [],
    createdAt: typeof raw.created === 'number' && Number.isFinite(raw.created) ? raw.created : null,
    isFree: promptPricePerMillion === 0 && completionPricePerMillion === 0
  }
}

/** No auth: OpenRouter's model catalog is public. Filtered server-side to tool-capable models, matching what OpenRouter mode actually needs (the agent always has MCP tools available). */
export async function fetchModels(fetchImpl: FetchLike = fetch): Promise<ApiResult<OpenRouterModel[]>> {
  const result = await requestJson(`${OPENROUTER_API_BASE}/models?supported_parameters=tools`, { headers: openRouterHeaders(null) }, fetchImpl)
  if (!result.ok) return result
  const list = isRecord(result.value.body) ? result.value.body.data : undefined
  if (!Array.isArray(list)) {
    appLogger.warn(`OpenRouter models response was malformed: ${preview(result.value.body)}`)
    return { ok: false, error: appError('openrouterRequestFailed', { status: result.value.status, message: 'Malformed models response.' }) }
  }
  const models: OpenRouterModel[] = []
  let skipped = 0
  for (const entry of list) {
    const mapped = mapModel(entry)
    if (mapped) models.push(mapped)
    else skipped++
  }
  if (skipped > 0) {
    appLogger.warn(`Skipped ${skipped} malformed model entr${skipped === 1 ? 'y' : 'ies'} from OpenRouter's model list.`)
  }
  return { ok: true, value: models }
}

export interface ExchangeAuthCodeParams {
  code: string
  verifier: string
}

export async function exchangeAuthCode(
  params: ExchangeAuthCodeParams,
  fetchImpl: FetchLike = fetch
): Promise<ApiResult<{ key: string }>> {
  const result = await requestJson(
    `${OPENROUTER_API_BASE}/auth/keys`,
    {
      method: 'POST',
      headers: { ...openRouterHeaders(null), 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: params.code, code_verifier: params.verifier, code_challenge_method: 'S256' })
    },
    fetchImpl
  )
  if (!result.ok) {
    // No key is sent on this call, so a 401 here is the authorization code
    // being refused (stale, reused, or from another verifier), not a key.
    if (result.error.code === 'openrouterKeyRejected') {
      return { ok: false, error: appError('openrouterAuthFailed', { message: 'OpenRouter rejected the authorization code.' }) }
    }
    return result
  }
  const body = result.value.body
  if (!isRecord(body) || typeof body.key !== 'string' || body.key.length === 0) {
    appLogger.warn(`OpenRouter auth key exchange response was malformed: ${preview(body)}`)
    return { ok: false, error: appError('openrouterRequestFailed', { status: result.value.status, message: 'Malformed key exchange response.' }) }
  }
  return { ok: true, value: { key: body.key } }
}

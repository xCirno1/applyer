/*
 * Plain-module logic behind `OpenRouterModelPicker` and
 * `OpenRouterModelSettings`: which reasoning efforts a model actually
 * supports, how a price/context number reads as a short label, and how a
 * catalog gets filtered/sorted for the search field. No React, no DOM,
 * same split as `workspace/workspaceLayout.ts` vs `useWorkspaceLayout.ts`,
 * so the rules here are exercised without mounting anything.
 */
import type { OpenRouterModel, ReasoningEffort } from '@shared/types/openrouter'

/**
 * Canonical order reasoning efforts are offered in, everywhere they're
 * offered. `'default'` (no `reasoning` parameter sent at all) always comes
 * first and is always offered, even for a model that reports none of the
 * others: it is the only option that never depends on what the model
 * claims to support.
 */
const EFFORT_DISPLAY_ORDER: readonly Exclude<ReasoningEffort, 'default'>[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
]

/**
 * The reasoning efforts a Select for this model should offer: `'default'`
 * plus whichever of the model's own `reasoningEfforts` are real (not a
 * stray `'default'` a malformed catalog entry might carry), in the fixed
 * display order rather than whatever order the API happened to list them.
 */
export function selectableReasoningEfforts(modelEfforts: readonly ReasoningEffort[] | undefined): ReasoningEffort[] {
  const reported = new Set((modelEfforts ?? []).filter((effort) => effort !== 'default'))
  return ['default', ...EFFORT_DISPLAY_ORDER.filter((effort) => reported.has(effort))]
}

/**
 * The effort to keep selected after the model changes. A previously chosen
 * effort that the new model doesn't report is silently invalid: sending it
 * would either be ignored or rejected by OpenRouter, so it falls back to
 * `'default'` rather than staying on a value the UI is about to disable.
 */
export function reconcileReasoningEffort(
  current: ReasoningEffort,
  selectable: readonly ReasoningEffort[]
): ReasoningEffort {
  return selectable.includes(current) ? current : 'default'
}

/**
 * "$0.15" for a real price, `null` for "unknown/variable" (some models price
 * per-request or per-image rather than per-token, and OpenRouter reports
 * that as `null`). The caller shows its own localized "variable" string
 * for `null` rather than this module guessing at English.
 *
 * Always USD regardless of the active locale (that's what OpenRouter bills
 * in), so this never uses `Intl`'s currency style, which would print the
 * wrong symbol/placement for a non-US locale, only its number grouping.
 */
export function formatPricePerMillion(pricePerMillion: number | null, locale: string): string | null {
  if (pricePerMillion === null || !Number.isFinite(pricePerMillion)) return null
  if (pricePerMillion < 0) return null
  const decimals = pricePerMillion === 0 ? 2 : pricePerMillion < 0.01 ? 4 : pricePerMillion < 1 ? 3 : 2
  try {
    const formatted = new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(pricePerMillion)
    return `$${formatted}`
  } catch {
    return `$${pricePerMillion.toFixed(decimals)}`
  }
}

/** Drops a trailing ".0" ("1M" rather than "1.0M") but keeps one real decimal ("1.5M"). */
function trimTrailingZero(value: number): string {
  return value % 1 === 0 ? String(value) : value.toFixed(1)
}

/**
 * "128K", "1M", "8K": short enough for a row label. `null` for a length
 * that can't be a real context window (missing, zero, negative, NaN from a
 * malformed catalog entry), so the caller can omit the label entirely
 * rather than showing "0 ctx" or "NaN ctx".
 */
export function formatContextLength(contextLength: number): string | null {
  if (!Number.isFinite(contextLength) || contextLength <= 0) return null
  if (contextLength >= 1_000_000) return `${trimTrailingZero(contextLength / 1_000_000)}M`
  if (contextLength >= 1_000) return `${trimTrailingZero(contextLength / 1_000)}K`
  return String(contextLength)
}

/**
 * Case-insensitive substring match against the model's name or id, the two
 * things a user would actually type to find a model ("claude", "gpt-4o",
 * "deepseek/deepseek-v4.1"). An empty/whitespace-only query matches
 * everything rather than nothing, so clearing the field un-filters the list.
 */
export function matchesModelQuery(model: OpenRouterModel, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  return model.name.toLowerCase().includes(needle) || model.id.toLowerCase().includes(needle)
}

/** Filters by `matchesModelQuery`, then sorts by name (case-insensitive, stable on ties by id). */
export function filterAndSortModels(models: readonly OpenRouterModel[], query: string): OpenRouterModel[] {
  return models
    .filter((model) => matchesModelQuery(model, query))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

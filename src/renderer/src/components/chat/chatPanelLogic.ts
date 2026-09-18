import type { ChatSession } from '@shared/types/chat'
import type { OpenRouterModel } from '@shared/types/openrouter'
import { filterAndSortModels } from '../settings/openRouterModelLogic'

/*
 * Plain-module half of the chat panel: the session list's filter, the
 * short labels the composer footer and status bar show, and the "how long
 * ago" arithmetic behind each session row. No React, no DOM, same split as
 * `workspace/workspaceLayout.ts` vs `useWorkspaceLayout.ts`, so the rules
 * are exercised without mounting the panel.
 */

/** Case-insensitive substring match on the title; a blank query keeps every session, in the order given. */
export function filterSessions(sessions: readonly ChatSession[], query: string): ChatSession[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return [...sessions]
  return sessions.filter((session) => session.title.toLowerCase().includes(needle))
}

/**
 * "deepseek/deepseek-v4.1-flash" reads as "deepseek-v4.1-flash" in a
 * footer a few hundred pixels wide; the vendor half is still in the
 * tooltip. A `:free` (or any other) variant suffix stays, since it changes
 * what the model costs. An id with no slash is shown as-is.
 */
export function shortModelName(modelId: string): string {
  const slash = modelId.indexOf('/')
  const rest = slash === -1 ? modelId : modelId.slice(slash + 1)
  return rest.length > 0 ? rest : modelId
}

/** "$0" / "$0.0012" / "$1.25": four decimals under a cent so a cheap model's real cost isn't rounded to nothing. */
export function formatCost(costUsd: number): string {
  if (!Number.isFinite(costUsd)) return ''
  if (costUsd === 0) return '$0'
  const decimals = Math.abs(costUsd) < 0.01 ? 4 : 2
  return `$${costUsd.toFixed(decimals)}`
}

export type RelativeUnit = 'second' | 'minute' | 'hour' | 'day'

export interface RelativeAge {
  unit: RelativeUnit
  /** Always non-positive: the timestamp is in the past (a future one clamps to "now"). */
  value: number
}

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
/** Past this the row shows a date instead; "45 days ago" says less than "2 Aug". */
const MAX_RELATIVE_DAYS = 30

/**
 * The unit and (negative) amount for `Intl.RelativeTimeFormat`, or `null`
 * when the timestamp is unparseable or old enough that an absolute date
 * reads better. The caller formats, since only it knows the active locale.
 */
export function relativeAge(iso: string, nowMs: number): RelativeAge | null {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return null
  const elapsed = Math.max(0, nowMs - then)
  // `0 - n` rather than `-n` so a zero amount is +0, not the -0 that
  // `Intl.RelativeTimeFormat` would happily print as "in 0 seconds".
  if (elapsed < MINUTE_MS) return { unit: 'second', value: 0 - Math.floor(elapsed / SECOND_MS) }
  if (elapsed < HOUR_MS) return { unit: 'minute', value: 0 - Math.floor(elapsed / MINUTE_MS) }
  if (elapsed < DAY_MS) return { unit: 'hour', value: 0 - Math.floor(elapsed / HOUR_MS) }
  const days = Math.floor(elapsed / DAY_MS)
  if (days > MAX_RELATIVE_DAYS) return null
  return { unit: 'day', value: 0 - days }
}

/** How many rows the model quick-pick shows at once: enough to scan, few enough that the popover stays a popover. */
export const MODEL_MENU_PAGE = 30

export interface ModelMatches {
  shown: OpenRouterModel[]
  /** Matches past `MODEL_MENU_PAGE`, so the menu can say "keep typing" rather than silently truncate. */
  hiddenCount: number
}

/** The quick-pick's rows: the catalog filtered/sorted like the Settings picker, capped to one page. */
export function modelMatches(models: readonly OpenRouterModel[], query: string, limit = MODEL_MENU_PAGE): ModelMatches {
  const all = filterAndSortModels(models, query)
  return { shown: all.slice(0, limit), hiddenCount: Math.max(0, all.length - limit) }
}

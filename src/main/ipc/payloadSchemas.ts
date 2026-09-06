import { z } from 'zod'
import { ALL_EXPORT_DOMAINS } from '@shared/types/dataTransfer'
import { appLogger } from '../logger'

/**
 * Shapes for the payloads IPC handlers receive.
 *
 * The renderer is the only caller today, so nothing here is defending against
 * a hostile sender. It is defending against two ordinary ones: a bug on the
 * other side of the bridge, and a renderer compromised through content it did
 * not author (a job description rendered in the detail modal is, in the end,
 * text a third party wrote). Either way an unchecked payload is a `TypeError`
 * inside a handler, which reaches the renderer as a bare rejected promise
 * rather than as one of the typed errors the UI knows how to show.
 *
 * Two rules, applied consistently below:
 *
 * - A **read** (any `list`) never fails over its filters. A malformed query is
 *   logged and falls back to the unfiltered default, because refusing to show
 *   a list because one optional filter arrived wrong is worse than showing the
 *   list. The repositories clamp limits themselves, so the fallback is bounded.
 * - A **write** rejects, returning the same typed error shape that handler
 *   already used for its other failures. Guessing what an ambiguous mutation
 *   meant is how you delete the wrong row.
 */

/** Ids are opaque strings (UUIDs, mostly) — non-empty is the only thing worth asserting about them. */
const id = z.string().min(1)

export const jobIdPayload = z.object({ jobId: id })
export const jobIdsPayload = z.object({ jobIds: z.array(id) })
export const excludeJobPayload = z.object({ jobId: id, reason: z.string().optional() })
export const documentIdPayload = z.object({ documentId: id })
export const exclusionIdPayload = z.object({ id })
export const taskIdPayload = z.object({ taskId: id })

export const browserPreferencePayload = z.object({
  preference: z.enum(['auto', 'chrome', 'msedge', 'managed'])
})
export const respondInstallPayload = z.object({ accept: z.boolean() })

export const mcpTargetPayload = z.object({
  cli: z.enum(['claude', 'codex']),
  scope: z.enum(['user', 'workspace'])
})

/**
 * Titles for a native dialog. Electron wants finished strings and the main
 * process has no locale, so these come from the renderer at call time — which
 * makes a missing one a blank dialog title rather than an error worth raising.
 */
export const dialogLabelsPayload = z.object({
  labels: z.object({ title: z.string(), filterName: z.string() })
})

export const csvTablePayload = z.object({
  table: z.enum(['jobs', 'exclusions', 'companyBoards', 'indexedJobs'])
})

export const exportSelectionSchema = z.object(
  Object.fromEntries(ALL_EXPORT_DOMAINS.map((domain) => [domain, z.boolean()])) as Record<
    (typeof ALL_EXPORT_DOMAINS)[number],
    z.ZodBoolean
  >
)

// --- list queries --------------------------------------------------------
//
// Every field optional, and every one of them dropped rather than defaulted if
// it arrives wrong: `.catch(undefined)` per field means a bad `limit` still
// leaves a working `search`.

const limit = z.number().int().positive().optional().catch(undefined)
const offset = z.number().int().nonnegative().optional().catch(undefined)
const search = z.string().optional().catch(undefined)

export const listJobsQuerySchema = z.object({
  status: z.enum(['queued', 'filled', 'submitted', 'failed']).optional().catch(undefined),
  source: z.string().optional().catch(undefined),
  sortBy: z.enum(['newest', 'matchScore']).optional().catch(undefined),
  search,
  limit,
  offset
})

export const listIndexedJobsQuerySchema = z.object({
  source: z.string().optional().catch(undefined),
  matched: z.enum(['all', 'matched', 'unmatched']).optional().catch(undefined),
  date: z.string().optional().catch(undefined),
  search,
  limit,
  offset
})

export const listExclusionsQuerySchema = z.object({ search, limit, offset })

export const listCompanyBoardsQuerySchema = z.object({ search, limit, offset })

export const listActivityQuerySchema = z.object({
  jobId: z.string().optional().catch(undefined),
  level: z.enum(['debug', 'info', 'warn', 'error']).optional().catch(undefined),
  limit,
  offset
})

/**
 * A list query, or the unfiltered default if it cannot be read at all (not an
 * object, or null). Per-field recovery is handled by the schemas above; this
 * covers the payload itself being the wrong kind of thing.
 */
export function readListQuery<T extends z.ZodType>(schema: T, raw: unknown, channel: string): z.infer<T> {
  const result = schema.safeParse(raw ?? {})
  if (result.success) return result.data
  appLogger.warn(`Ignoring an unreadable query for ${channel}; listing with defaults instead`)
  return schema.parse({})
}

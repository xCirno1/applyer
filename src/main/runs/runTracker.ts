import { appLogger } from '../logger'
import {
  createRun,
  endRun,
  getActiveRun,
  insertRunEvent,
  type InsertRunEventInput
} from '../db/repositories/runsRepository'
import { broadcastRunsChanged } from '../ipc/jobsBroadcast'
import type { RunEventKind, RunRecord } from '@shared/types/run'

/**
 * The one place that knows whether a run is in progress. Every observation
 * site in the app (the MCP tools, the fill runner, the user's board
 * actions) calls `recordRunEvent` unconditionally; this module drops the
 * event when nothing is being recorded and never throws, since a stats
 * hiccup must not fail the search or fill it was observing.
 *
 * The active run is read from the database once and then cached, so an
 * event costs one insert. A run survives an app restart on purpose: the
 * user started it and has not stopped it, and the agent may still be
 * working through the same task list.
 *
 * Renderer pushes are coalesced: an agent search lands a search event and
 * a tool_call event back to back, and a fill lands several, so the
 * broadcast waits a beat and fires once for the burst.
 */

const BROADCAST_DELAY_MS = 250

let activeRunId: string | null | undefined
let broadcastTimer: ReturnType<typeof setTimeout> | null = null

function resolveActiveRunId(): string | null {
  if (activeRunId === undefined) {
    try {
      activeRunId = getActiveRun()?.id ?? null
    } catch (err) {
      appLogger.warn(`Could not read the active run: ${String(err)}`)
      return null
    }
  }
  return activeRunId
}

function scheduleBroadcast(): void {
  if (broadcastTimer) return
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null
    broadcastRunsChanged()
  }, BROADCAST_DELAY_MS)
}

export function getCurrentRun(): RunRecord | null {
  try {
    const run = getActiveRun()
    activeRunId = run?.id ?? null
    return run
  } catch (err) {
    appLogger.warn(`Could not read the active run: ${String(err)}`)
    return null
  }
}

export function startRun(label: string | null = null): RunRecord {
  const run = createRun(label)
  activeRunId = run.id
  broadcastRunsChanged()
  return run
}

/** Ends the run in progress and returns it, or null when none was. */
export function stopRun(): RunRecord | null {
  const id = resolveActiveRunId()
  if (!id) return null
  const run = endRun(id)
  activeRunId = null
  broadcastRunsChanged()
  return run
}

export type RecordRunEventInput = Omit<InsertRunEventInput, 'runId' | 'kind'>

export function recordRunEvent(kind: RunEventKind, input: RecordRunEventInput = {}): void {
  const runId = resolveActiveRunId()
  if (!runId) return
  try {
    insertRunEvent({ runId, kind, ...input })
    scheduleBroadcast()
  } catch (err) {
    appLogger.warn(`Could not record run event ${kind}: ${String(err)}`)
  }
}

/** Test-only: forget the cached run so the next call reads the database again. */
export function __resetRunTracker(): void {
  activeRunId = undefined
  if (broadcastTimer) {
    clearTimeout(broadcastTimer)
    broadcastTimer = null
  }
}

import type {
  RunCaptchaStats,
  RunEvent,
  RunFillStats,
  RunMiscStats,
  RunPipelineStats,
  RunRecord,
  RunResumeStats,
  RunSearchMeta,
  RunSearchStats,
  RunSourceStats,
  RunStats,
  RunToolStats
} from '@shared/types/run'

/**
 * Folds a run's events into the numbers the Runs screen shows. Pure: the
 * repository loads, this counts, and nothing here trusts `meta`, since a
 * row's JSON is whatever an older or newer build wrote (every read goes
 * through `num`/`str`/`bool` and an unreadable field counts as absent).
 */

const RECENT_SEARCHES = 8

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function optionalNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function bool(value: unknown): boolean {
  return value === true
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function sortedCounts<K extends string>(counts: Map<string, number>, key: K): Array<Record<K, string> & { count: number }> {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ [key]: name, count }) as Record<K, string> & { count: number })
}

function bump(counts: Map<string, number>, key: string, by = 1): void {
  counts.set(key, (counts.get(key) ?? 0) + by)
}

function emptySource(source: string): RunSourceStats {
  return {
    source,
    searches: 0,
    results: 0,
    blocked: 0,
    warned: 0,
    detailsRead: 0,
    detailsBlocked: 0,
    queued: 0,
    queueExisting: 0,
    filled: 0,
    submitted: 0,
    failed: 0,
    excluded: 0
  }
}

function round(value: number, places = 1): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

export interface FoldWindow {
  limit: number
  truncated: boolean
}

/**
 * `window` says how the events were read (see `loadRunEvents`); when it is
 * left out the events are taken to be the whole run.
 */
export function computeRunStats(
  run: RunRecord,
  events: RunEvent[],
  now: Date = new Date(),
  window: FoldWindow = { limit: events.length, truncated: false }
): RunStats {
  const sources = new Map<string, RunSourceStats>()
  const sourceFor = (name: string | null): RunSourceStats | null => {
    if (!name) return null
    let entry = sources.get(name)
    if (!entry) {
      entry = emptySource(name)
      sources.set(name, entry)
    }
    return entry
  }

  const searches: RunSearchStats = {
    total: 0,
    failed: 0,
    results: 0,
    empty: 0,
    distinctQueries: 0,
    blockedHits: 0,
    avgResults: 0,
    avgDurationMs: 0,
    recent: []
  }
  const queries = new Set<string>()
  const allSearches: RunSearchStats['recent'] = []
  let searchDurationTotal = 0

  const pipeline: RunPipelineStats = {
    queued: 0,
    queueExisting: 0,
    queueExcluded: 0,
    submitted: 0,
    failed: 0,
    failureReasons: [],
    markedFilled: 0,
    retried: 0,
    unqueued: 0,
    removed: 0,
    excludedByUser: 0,
    excludedByAgent: 0,
    matchScore: { count: 0, avg: null, min: null, max: null }
  }
  const failureReasons = new Map<string, number>()
  let matchScoreTotal = 0

  const fills: RunFillStats = {
    inspected: 0,
    attempts: 0,
    filled: 0,
    partiallyFilled: 0,
    edited: 0,
    failed: 0,
    permissionDenied: 0,
    noSession: 0,
    buttonsClicked: 0,
    buttonsFailed: 0,
    fieldsFilled: 0,
    fieldsSkipped: 0
  }

  const captcha: RunCaptchaStats = { paused: 0, resolved: 0, reasons: [] }
  const captchaReasons = new Map<string, number>()

  const resumes: RunResumeStats = {
    attachedVariant: 0,
    attachedMaster: 0,
    variantsSaved: 0,
    assigned: 0,
    unassigned: 0,
    masterSaved: 0
  }

  const misc: RunMiscStats = {
    profileUpdates: 0,
    companyBoardsAdded: 0,
    companyBoardChecks: 0,
    companyBoardsChecked: 0,
    companyBoardPostings: 0
  }

  const tools: RunToolStats = { calls: 0, errors: 0, totalDurationMs: 0, byTool: [] }
  const toolCalls = new Map<string, { calls: number; errors: number; duration: number }>()

  for (const event of events) {
    const meta = event.meta ?? {}
    const source = sourceFor(event.source)

    switch (event.kind) {
      case 'search': {
        const search = meta as Partial<RunSearchMeta>
        searches.total += 1
        if (bool(search.failed)) {
          searches.failed += 1
          break
        }
        const results = num(search.results)
        searches.results += results
        if (results === 0) searches.empty += 1
        searchDurationTotal += num(search.durationMs)
        const query = str(search.query)
        if (query) queries.add(query.trim().toLowerCase())
        allSearches.push({
          query: query ?? '',
          location: str(search.location),
          country: str(search.country),
          results,
          at: event.createdAt
        })
        const perSource = record(search.sources) ?? {}
        for (const [name, raw] of Object.entries(perSource)) {
          const outcome = record(raw)
          const entry = sourceFor(name)
          if (!outcome || !entry) continue
          entry.searches += 1
          entry.results += num(outcome.results)
          if (bool(outcome.blocked)) {
            entry.blocked += 1
            searches.blockedHits += 1
          }
          if (bool(outcome.warned)) entry.warned += 1
        }
        break
      }
      case 'job_details': {
        if (!source) break
        if (str(meta.status) === 'blocked') source.detailsBlocked += 1
        else if (str(meta.status) === 'ok') source.detailsRead += 1
        break
      }
      case 'job_queued': {
        pipeline.queued += 1
        if (source) source.queued += 1
        const score = optionalNum(meta.matchScore)
        if (score !== null) {
          pipeline.matchScore.count += 1
          matchScoreTotal += score
          pipeline.matchScore.min = pipeline.matchScore.min === null ? score : Math.min(pipeline.matchScore.min, score)
          pipeline.matchScore.max = pipeline.matchScore.max === null ? score : Math.max(pipeline.matchScore.max, score)
        }
        break
      }
      case 'job_queue_existing':
        pipeline.queueExisting += 1
        if (source) source.queueExisting += 1
        break
      case 'job_queue_excluded':
        pipeline.queueExcluded += 1
        break
      case 'form_inspected':
        fills.inspected += 1
        break
      case 'form_filled': {
        fills.attempts += 1
        const status = str(meta.status)
        if (status === 'filled') {
          fills.filled += 1
          if (source) source.filled += 1
        } else if (status === 'partially_filled') {
          fills.partiallyFilled += 1
          if (source) source.filled += 1
        } else if (status === 'edited') fills.edited += 1
        else if (status === 'failed') fills.failed += 1
        else if (status === 'permission_denied') fills.permissionDenied += 1
        else if (status === 'no_active_session') fills.noSession += 1
        fills.fieldsFilled += num(meta.filledFields)
        fills.fieldsSkipped += num(meta.skippedFields)
        break
      }
      case 'button_clicked':
        if (str(meta.status) === 'clicked') fills.buttonsClicked += 1
        else fills.buttonsFailed += 1
        break
      case 'captcha_paused':
        captcha.paused += 1
        bump(captchaReasons, str(meta.reason) ?? 'unknown')
        break
      case 'captcha_resolved':
        captcha.resolved += 1
        break
      case 'job_failed':
        pipeline.failed += 1
        if (source) source.failed += 1
        bump(failureReasons, str(meta.reasonTag) ?? 'other')
        break
      case 'job_submitted':
        pipeline.submitted += 1
        if (source) source.submitted += 1
        break
      case 'job_marked_filled':
        pipeline.markedFilled += 1
        if (source) source.filled += 1
        break
      case 'job_retried':
        pipeline.retried += 1
        break
      case 'job_unqueued':
        pipeline.unqueued += 1
        break
      case 'job_removed':
        pipeline.removed += 1
        break
      case 'job_excluded':
        if (str(meta.by) === 'agent') pipeline.excludedByAgent += 1
        else pipeline.excludedByUser += 1
        if (source) source.excluded += 1
        break
      case 'resume_attached':
        if (str(meta.kind) === 'variant') resumes.attachedVariant += 1
        else resumes.attachedMaster += 1
        break
      case 'resume_variant_saved':
        resumes.variantsSaved += 1
        break
      case 'resume_assigned':
        if (bool(meta.assigned)) resumes.assigned += 1
        else resumes.unassigned += 1
        break
      case 'resume_master_saved':
        resumes.masterSaved += 1
        break
      case 'profile_updated':
        misc.profileUpdates += 1
        break
      case 'company_board_added':
        misc.companyBoardsAdded += 1
        break
      case 'company_boards_checked':
        misc.companyBoardChecks += 1
        misc.companyBoardsChecked += num(meta.checked)
        misc.companyBoardPostings += num(meta.postings)
        break
      case 'tool_call': {
        const tool = str(meta.tool) ?? 'unknown'
        const isError = bool(meta.isError)
        const duration = num(meta.durationMs)
        tools.calls += 1
        if (isError) tools.errors += 1
        tools.totalDurationMs += duration
        const entry = toolCalls.get(tool) ?? { calls: 0, errors: 0, duration: 0 }
        entry.calls += 1
        if (isError) entry.errors += 1
        entry.duration += duration
        toolCalls.set(tool, entry)
        break
      }
    }
  }

  const completedSearches = searches.total - searches.failed
  searches.distinctQueries = queries.size
  searches.recent = allSearches.slice(-RECENT_SEARCHES).reverse()
  searches.avgResults = completedSearches > 0 ? round(searches.results / completedSearches) : 0
  searches.avgDurationMs = completedSearches > 0 ? Math.round(searchDurationTotal / completedSearches) : 0
  pipeline.failureReasons = sortedCounts(failureReasons, 'reasonTag')
  pipeline.matchScore.avg = pipeline.matchScore.count > 0 ? round(matchScoreTotal / pipeline.matchScore.count) : null
  captcha.reasons = sortedCounts(captchaReasons, 'reason')
  tools.byTool = [...toolCalls.entries()]
    .sort((a, b) => b[1].calls - a[1].calls || a[0].localeCompare(b[0]))
    .map(([tool, entry]) => ({
      tool,
      calls: entry.calls,
      errors: entry.errors,
      avgDurationMs: Math.round(entry.duration / entry.calls)
    }))

  const startedMs = Date.parse(run.startedAt)
  const endedMs = run.endedAt ? Date.parse(run.endedAt) : now.getTime()
  const durationMs = Number.isFinite(startedMs) && Number.isFinite(endedMs) ? Math.max(0, endedMs - startedMs) : 0
  const hours = durationMs / 3_600_000
  const eventsPerHour = hours > 0 ? round(events.length / hours) : 0

  return {
    run,
    foldedEvents: events.length,
    foldLimit: window.limit,
    foldTruncated: window.truncated,
    durationMs,
    eventsPerHour,
    firstEventAt: events[0]?.createdAt ?? null,
    lastEventAt: events[events.length - 1]?.createdAt ?? null,
    searches,
    sources: [...sources.values()],
    pipeline,
    fills,
    captcha,
    resumes,
    misc,
    tools
  }
}

import { describe, it, expect } from 'vitest'
import { computeRunStats } from './runStats'
import type { RunEvent, RunEventKind, RunRecord } from '@shared/types/run'

const run: RunRecord = {
  id: 'run-1',
  label: null,
  sequence: 1,
  startedAt: '2026-09-15T10:00:00.000Z',
  endedAt: null,
  eventCount: 0
}

let nextId = 1
function event(
  kind: RunEventKind,
  extra: { source?: string | null; jobId?: string | null; meta?: Record<string, unknown> | null; at?: string } = {}
): RunEvent {
  return {
    id: nextId++,
    runId: run.id,
    kind,
    source: extra.source ?? null,
    jobId: extra.jobId ?? null,
    meta: extra.meta ?? null,
    createdAt: extra.at ?? '2026-09-15T10:30:00.000Z'
  }
}

const now = new Date('2026-09-15T12:00:00.000Z')

describe('computeRunStats', () => {
  it('folds an empty run into zeros and the elapsed time', () => {
    const stats = computeRunStats(run, [], now)
    expect(stats).toMatchObject({ foldedEvents: 0, foldLimit: 0, foldTruncated: false })
    expect(stats.durationMs).toBe(2 * 3_600_000)
    expect(stats.eventsPerHour).toBe(0)
    expect(stats.firstEventAt).toBeNull()
    expect(stats.searches.total).toBe(0)
    expect(stats.sources).toEqual([])
    expect(stats.pipeline.matchScore).toEqual({ count: 0, avg: null, min: null, max: null })
    expect(stats.tools.byTool).toEqual([])
  })

  it('uses the run end rather than now for a finished run', () => {
    const finished = { ...run, endedAt: '2026-09-15T10:45:00.000Z' }
    expect(computeRunStats(finished, [], now).durationMs).toBe(45 * 60_000)
  })

  it('does not trust an unparseable timestamp', () => {
    expect(computeRunStats({ ...run, startedAt: 'garbage' }, [], now).durationMs).toBe(0)
  })

  it('folds searches into totals, per-site outcomes and the recent list', () => {
    const events = [
      event('search', {
        at: '2026-09-15T10:01:00.000Z',
        meta: {
          query: 'Backend engineer',
          location: 'Sydney',
          country: 'au',
          results: 12,
          durationMs: 4000,
          failed: false,
          sources: {
            seek: { results: 10, blocked: false, warned: false },
            indeed: { results: 4, blocked: false, warned: true },
            prosple: { results: 0, blocked: true, warned: true }
          },
          warnings: ['prosple: blocked']
        }
      }),
      event('search', {
        at: '2026-09-15T10:02:00.000Z',
        meta: { query: 'backend ENGINEER', results: 0, durationMs: 2000, failed: false, sources: { seek: { results: 0 } } }
      }),
      event('search', { at: '2026-09-15T10:03:00.000Z', meta: { query: 'x', failed: true } })
    ]
    const stats = computeRunStats(run, events, now)
    expect(stats.searches).toMatchObject({
      total: 3,
      failed: 1,
      results: 12,
      empty: 1,
      // The two spellings of "backend engineer" are one query; the failed search does not count.
      distinctQueries: 1,
      blockedHits: 1,
      avgResults: 6,
      avgDurationMs: 3000
    })
    expect(stats.searches.recent.map((s) => s.query)).toEqual(['backend ENGINEER', 'Backend engineer'])
    expect(stats.searches.recent[1]).toMatchObject({ location: 'Sydney', country: 'au', results: 12 })

    const seek = stats.sources.find((s) => s.source === 'seek')
    expect(seek).toMatchObject({ searches: 2, results: 10, blocked: 0, warned: 0 })
    expect(stats.sources.find((s) => s.source === 'indeed')).toMatchObject({ searches: 1, results: 4, warned: 1 })
    expect(stats.sources.find((s) => s.source === 'prosple')).toMatchObject({ searches: 1, results: 0, blocked: 1, warned: 1 })
  })

  it('keeps only the most recent searches, newest first', () => {
    const events = Array.from({ length: 12 }, (_, i) =>
      event('search', { at: `2026-09-15T10:${String(i).padStart(2, '0')}:00.000Z`, meta: { query: `q${i}`, results: 1, sources: {} } })
    )
    const recent = computeRunStats(run, events, now).searches.recent
    expect(recent).toHaveLength(8)
    expect(recent[0]?.query).toBe('q11')
    expect(recent[7]?.query).toBe('q4')
  })

  it('folds the pipeline, per source, with match score bounds and failure reasons', () => {
    const events = [
      event('job_queued', { source: 'seek', jobId: 'j1', meta: { matchScore: 90 } }),
      event('job_queued', { source: 'seek', jobId: 'j2', meta: { matchScore: 70 } }),
      event('job_queued', { source: 'linkedin', jobId: 'j3', meta: { matchScore: null } }),
      event('job_queue_existing', { source: 'seek', jobId: 'j1' }),
      event('job_queue_excluded', { source: 'jora' }),
      event('job_submitted', { source: 'seek', jobId: 'j1' }),
      event('job_failed', { source: 'linkedin', jobId: 'j3', meta: { reasonTag: 'login_required', by: 'agent' } }),
      event('job_failed', { source: 'seek', jobId: 'j2', meta: { reasonTag: 'login_required', by: 'app' } }),
      event('job_failed', { source: 'seek', jobId: 'j2', meta: { reasonTag: 'expired_listing' } }),
      event('job_marked_filled', { source: 'indeed', jobId: 'j4' }),
      event('job_retried', { jobId: 'j2' }),
      event('job_unqueued', { jobId: 'j5' }),
      event('job_removed', { jobId: 'j1' }),
      event('job_excluded', { source: 'seek', meta: { by: 'user' } }),
      event('job_excluded', { source: 'seek', meta: { by: 'agent' } })
    ]
    const stats = computeRunStats(run, events, now)
    expect(stats.pipeline).toMatchObject({
      queued: 3,
      queueExisting: 1,
      queueExcluded: 1,
      submitted: 1,
      failed: 3,
      markedFilled: 1,
      retried: 1,
      unqueued: 1,
      removed: 1,
      excludedByUser: 1,
      excludedByAgent: 1,
      matchScore: { count: 2, avg: 80, min: 70, max: 90 }
    })
    expect(stats.pipeline.failureReasons).toEqual([
      { reasonTag: 'login_required', count: 2 },
      { reasonTag: 'expired_listing', count: 1 }
    ])
    expect(stats.sources.find((s) => s.source === 'seek')).toMatchObject({
      queued: 2,
      queueExisting: 1,
      submitted: 1,
      failed: 2,
      excluded: 2
    })
    expect(stats.sources.find((s) => s.source === 'indeed')).toMatchObject({ filled: 1 })
    expect(stats.sources.map((s) => s.source)).toEqual(['seek', 'linkedin', 'jora', 'indeed'])
  })

  it('folds forms, buttons and challenges', () => {
    const events = [
      event('form_inspected', { source: 'greenhouse', meta: { status: 'inspected', fields: 9 } }),
      event('form_inspected', { source: 'greenhouse', meta: { status: 'failed' } }),
      event('form_filled', { source: 'greenhouse', meta: { status: 'filled', filledFields: 8, skippedFields: 1 } }),
      event('form_filled', { source: 'lever', meta: { status: 'partially_filled', filledFields: 3, skippedFields: 4 } }),
      event('form_filled', { source: 'lever', meta: { status: 'edited', filledFields: 1, skippedFields: 0 } }),
      event('form_filled', { meta: { status: 'failed', reasonTag: 'form_not_supported' } }),
      event('form_filled', { meta: { status: 'permission_denied' } }),
      event('form_filled', { meta: { status: 'no_active_session' } }),
      event('button_clicked', { meta: { status: 'clicked' } }),
      event('button_clicked', { meta: { status: 'failed' } }),
      event('captcha_paused', { meta: { reason: 'cloudflare' } }),
      event('captcha_paused', { meta: { reason: 'cloudflare' } }),
      event('captcha_paused', { meta: {} }),
      event('captcha_resolved')
    ]
    const stats = computeRunStats(run, events, now)
    expect(stats.fills).toEqual({
      inspected: 2,
      attempts: 6,
      filled: 1,
      partiallyFilled: 1,
      edited: 1,
      failed: 1,
      permissionDenied: 1,
      noSession: 1,
      buttonsClicked: 1,
      buttonsFailed: 1,
      fieldsFilled: 12,
      fieldsSkipped: 5
    })
    expect(stats.sources.find((s) => s.source === 'greenhouse')?.filled).toBe(1)
    expect(stats.sources.find((s) => s.source === 'lever')?.filled).toBe(1)
    expect(stats.captcha).toEqual({
      paused: 3,
      resolved: 1,
      reasons: [
        { reason: 'cloudflare', count: 2 },
        { reason: 'unknown', count: 1 }
      ]
    })
  })

  it('folds details, resumes, profile, company boards and tool calls', () => {
    const events = [
      event('job_details', { source: 'seek', meta: { status: 'ok' } }),
      event('job_details', { source: 'seek', meta: { status: 'ok', cached: true } }),
      event('job_details', { source: 'prosple', meta: { status: 'blocked' } }),
      event('job_details', { source: 'seek', meta: { status: 'not_found' } }),
      event('resume_attached', { meta: { kind: 'variant' } }),
      event('resume_attached', { meta: { kind: 'master' } }),
      event('resume_attached'),
      event('resume_variant_saved', { meta: { name: 'Backend' } }),
      event('resume_assigned', { meta: { assigned: true } }),
      event('resume_assigned', { meta: { assigned: false } }),
      event('resume_master_saved'),
      event('profile_updated', { meta: { fields: ['skills'] } }),
      event('company_board_added', { source: 'greenhouse' }),
      event('company_boards_checked', { meta: { checked: 5, failed: 1, postings: 40 } }),
      event('company_boards_checked', { meta: { checked: 2, postings: 3 } }),
      event('tool_call', { meta: { tool: 'search_jobs', isError: false, durationMs: 3000 } }),
      event('tool_call', { meta: { tool: 'search_jobs', isError: true, durationMs: 1000 } }),
      event('tool_call', { meta: { tool: 'queue_job', durationMs: 10 } }),
      event('tool_call', { meta: {} })
    ]
    const stats = computeRunStats(run, events, now)
    expect(stats.sources.find((s) => s.source === 'seek')).toMatchObject({ detailsRead: 2, detailsBlocked: 0 })
    expect(stats.sources.find((s) => s.source === 'prosple')).toMatchObject({ detailsRead: 0, detailsBlocked: 1 })
    expect(stats.resumes).toEqual({
      attachedVariant: 1,
      attachedMaster: 2,
      variantsSaved: 1,
      assigned: 1,
      unassigned: 1,
      masterSaved: 1
    })
    expect(stats.misc).toEqual({
      profileUpdates: 1,
      companyBoardsAdded: 1,
      companyBoardChecks: 2,
      companyBoardsChecked: 7,
      companyBoardPostings: 43
    })
    expect(stats.tools).toEqual({
      calls: 4,
      errors: 1,
      totalDurationMs: 4010,
      byTool: [
        { tool: 'search_jobs', calls: 2, errors: 1, avgDurationMs: 2000 },
        { tool: 'queue_job', calls: 1, errors: 0, avgDurationMs: 10 },
        { tool: 'unknown', calls: 1, errors: 0, avgDurationMs: 0 }
      ]
    })
  })

  it('reports first/last event times and the event rate', () => {
    const events = [
      event('search', { at: '2026-09-15T10:10:00.000Z', meta: { results: 1, sources: {} } }),
      event('job_queued', { at: '2026-09-15T11:10:00.000Z' })
    ]
    const stats = computeRunStats(run, events, now)
    expect(stats.firstEventAt).toBe('2026-09-15T10:10:00.000Z')
    expect(stats.lastEventAt).toBe('2026-09-15T11:10:00.000Z')
    expect(stats.eventsPerHour).toBe(1)
  })

  it('shrugs off meta of the wrong shape', () => {
    const events = [
      event('search', { meta: { query: 42, results: 'lots', sources: 'nope', durationMs: NaN } }),
      event('job_queued', { source: 'seek', meta: { matchScore: 'high' } }),
      event('form_filled', { meta: { status: 7, filledFields: [] } }),
      event('tool_call', { meta: { tool: '', durationMs: '3' } })
    ]
    const stats = computeRunStats(run, events, now)
    expect(stats.searches).toMatchObject({ total: 1, results: 0, empty: 1, distinctQueries: 0, avgDurationMs: 0 })
    expect(stats.pipeline.queued).toBe(1)
    expect(stats.pipeline.matchScore.count).toBe(0)
    expect(stats.fills).toMatchObject({ attempts: 1, filled: 0, fieldsFilled: 0 })
    expect(stats.tools.byTool[0]).toMatchObject({ tool: 'unknown', avgDurationMs: 0 })
  })
})

describe('computeRunStats fold window', () => {
  it('reports how many events the figures cover and whether the run holds more', () => {
    const events = [event('search'), event('search')]
    const stats = computeRunStats(run, events, now, { limit: 2, truncated: true })
    expect(stats.searches.total).toBe(2)
    expect(stats).toMatchObject({ foldedEvents: 2, foldLimit: 2, foldTruncated: true })
  })
})

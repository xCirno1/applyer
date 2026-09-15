import { describe, it, expect } from 'vitest'
import i18next from 'i18next'
import { describeRunEvent, runEventTone } from './describeRunEvent'
import enRuns from '../../i18n/locales/en/runs.json'
import type { RunEventKind, RunEventView } from '@shared/types/run'

// A real i18next instance over the English catalog rather than a stub, so
// the interpolation keys the sentences use are checked against the strings
// that ship: a renamed placeholder shows up here as "{{job}}" in the output.
const i18n = i18next.createInstance()
await i18n.init({ lng: 'en', resources: { en: { runs: enRuns } }, ns: ['runs'], defaultNS: 'runs', interpolation: { escapeValue: false } })
const t = i18n.getFixedT('en', 'runs')

let nextId = 1
function event(kind: RunEventKind, extra: Partial<RunEventView> = {}): RunEventView {
  return {
    id: nextId++,
    runId: 'run-1',
    kind,
    source: null,
    jobId: null,
    meta: null,
    createdAt: '2026-09-15T10:00:00.000Z',
    jobTitle: null,
    jobCompany: null,
    ...extra
  }
}

const withJob = { jobId: 'j1', jobTitle: 'Backend Engineer', jobCompany: 'Acme' }

describe('describeRunEvent', () => {
  it('describes a search with its query, place and results', () => {
    const text = describeRunEvent(
      event('search', { meta: { query: 'engineer', location: 'Sydney', country: 'au', results: 12 } }),
      t
    )
    expect(text).toBe('Searched "engineer" Sydney (AU): 12 results')
  })

  it('reads "anywhere" for a search without a location and singular for one result', () => {
    expect(describeRunEvent(event('search', { meta: { query: 'x', results: 1 } }), t)).toBe('Searched "x" anywhere: 1 result')
  })

  it('describes a failed search', () => {
    expect(describeRunEvent(event('search', { meta: { query: 'x', failed: true } }), t)).toBe('Search "x" failed')
  })

  it('names the job when it still exists and says "a job" when it does not', () => {
    expect(describeRunEvent(event('job_queued', { source: 'seek', ...withJob }), t)).toBe('Queued Backend Engineer at Acme from Seek')
    expect(describeRunEvent(event('job_queued', { source: 'seek', jobId: 'gone' }), t)).toBe('Queued a job from Seek')
  })

  it('describes each details outcome', () => {
    expect(describeRunEvent(event('job_details', { source: 'seek', meta: { status: 'ok' } }), t)).toBe('Read a posting on Seek')
    expect(describeRunEvent(event('job_details', { source: 'prosple', meta: { status: 'blocked' } }), t)).toBe(
      'A posting on Prosple answered with a challenge'
    )
    expect(describeRunEvent(event('job_details', { source: 'x', meta: { status: 'not_found' } }), t)).toBe('A posting on x could not be read')
  })

  it('describes fills with their status and an unknown status as "?"', () => {
    expect(describeRunEvent(event('form_filled', { ...withJob, meta: { status: 'partially_filled' } }), t)).toBe(
      'Filled the form for Backend Engineer at Acme (partially filled)'
    )
    expect(describeRunEvent(event('form_filled', { ...withJob, meta: { status: 'weird' } }), t)).toBe(
      'Filled the form for Backend Engineer at Acme (?)'
    )
  })

  it('describes exclusions by who did them', () => {
    expect(describeRunEvent(event('job_excluded', { source: 'indeed', meta: { by: 'agent' } }), t)).toBe(
      'Excluded a posting from Indeed (by the agent)'
    )
    expect(describeRunEvent(event('job_excluded', { source: 'indeed', meta: { by: 'user' } }), t)).toBe(
      'Excluded a posting from Indeed (by you)'
    )
  })

  it('describes resume events', () => {
    expect(describeRunEvent(event('resume_attached', { ...withJob, meta: { kind: 'variant' } }), t)).toBe(
      'Attached the tailored resume to Backend Engineer at Acme'
    )
    expect(describeRunEvent(event('resume_assigned', { ...withJob, meta: { assigned: false } }), t)).toBe(
      'Unassigned the resume variant from Backend Engineer at Acme'
    )
    expect(describeRunEvent(event('resume_variant_saved', { meta: { name: 'Backend' } }), t)).toBe('Saved the resume variant "Backend"')
  })

  it('describes tool calls, including a failed one', () => {
    expect(describeRunEvent(event('tool_call', { meta: { tool: 'search_jobs' } }), t)).toBe('search_jobs')
    expect(describeRunEvent(event('tool_call', { meta: { tool: 'queue_job', isError: true } }), t)).toBe('queue_job answered with an error')
  })

  it('tells a search waiting on a challenge apart from a job doing so', () => {
    expect(describeRunEvent(event('captcha_paused', { ...withJob }), t)).toBe(
      'Backend Engineer at Acme paused on a verification challenge'
    )
    expect(describeRunEvent(event('captcha_paused', { source: 'prosple', meta: { search: true, reason: 'challenge_text' } }), t)).toBe(
      'A search on Prosple paused on a verification challenge'
    )
    expect(describeRunEvent(event('captcha_resolved', { source: 'prosple', meta: { search: true } }), t)).toBe(
      'The search on Prosple resumed after the challenge'
    )
  })

  it('never leaves a placeholder unfilled for any kind with empty meta', () => {
    const kinds: RunEventKind[] = [
      'search',
      'job_details',
      'job_queued',
      'job_queue_existing',
      'job_queue_excluded',
      'form_inspected',
      'form_filled',
      'button_clicked',
      'captcha_paused',
      'captcha_resolved',
      'job_failed',
      'job_submitted',
      'job_marked_filled',
      'job_retried',
      'job_unqueued',
      'job_removed',
      'job_excluded',
      'resume_attached',
      'resume_variant_saved',
      'resume_assigned',
      'resume_master_saved',
      'profile_updated',
      'company_board_added',
      'company_boards_checked',
      'tool_call'
    ]
    for (const kind of kinds) {
      const text = describeRunEvent(event(kind), t)
      expect(text, kind).not.toMatch(/\{\{|undefined|null/)
      expect(text.length, kind).toBeGreaterThan(0)
    }
  })
})

describe('runEventTone', () => {
  it('marks failures and challenges as danger', () => {
    expect(runEventTone(event('job_failed'))).toBe('danger')
    expect(runEventTone(event('captcha_paused'))).toBe('danger')
    expect(runEventTone(event('search', { meta: { failed: true } }))).toBe('danger')
  })

  it('grades fill outcomes', () => {
    expect(runEventTone(event('form_filled', { meta: { status: 'filled' } }))).toBe('success')
    expect(runEventTone(event('form_filled', { meta: { status: 'partially_filled' } }))).toBe('warning')
    expect(runEventTone(event('form_filled', { meta: { status: 'failed' } }))).toBe('danger')
  })

  it('keeps ordinary rows neutral', () => {
    expect(runEventTone(event('job_queued'))).toBe('neutral')
    expect(runEventTone(event('tool_call', { meta: { tool: 'x' } }))).toBe('neutral')
    expect(runEventTone(event('job_details', { meta: { status: 'ok' } }))).toBe('neutral')
  })
})

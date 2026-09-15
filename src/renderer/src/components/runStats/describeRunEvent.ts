import type { TFunction } from 'i18next'
import type { RunEventView } from '@shared/types/run'
import { sourceLabel } from './runFormat'

/**
 * One sentence per timeline row. Every read of `meta` is guarded: a row's
 * JSON is whatever the build that wrote it put there, so a missing or
 * oddly typed field falls back to a generic wording rather than rendering
 * "undefined" into the timeline.
 */

type T = TFunction<'runs'>

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function jobName(event: RunEventView, t: T): string {
  if (event.jobTitle && event.jobCompany) return t('events.jobAt', { title: event.jobTitle, company: event.jobCompany })
  return event.jobTitle ?? t('events.unknownJob')
}

function source(event: RunEventView): string {
  return event.source ? sourceLabel(event.source) : '?'
}

const FILL_STATUSES = ['filled', 'partially_filled', 'edited', 'failed', 'permission_denied', 'no_active_session'] as const
type FillStatus = (typeof FILL_STATUSES)[number]

function fillStatus(value: unknown): FillStatus | null {
  return typeof value === 'string' && (FILL_STATUSES as readonly string[]).includes(value) ? (value as FillStatus) : null
}

export function describeRunEvent(event: RunEventView, t: T): string {
  const meta = event.meta ?? {}
  const job = jobName(event, t)

  switch (event.kind) {
    case 'search': {
      const query = str(meta.query) ?? ''
      if (meta.failed === true) return t('events.searchFailed', { query })
      const location = str(meta.location)
      const country = str(meta.country)
      const where = [location ?? t('searches.anywhere'), country ? `(${country.toUpperCase()})` : null].filter(Boolean).join(' ')
      return t('events.search', { query, where, results: t('searches.resultCount', { count: num(meta.results) ?? 0 }) })
    }
    case 'job_details': {
      const status = str(meta.status)
      if (status === 'blocked') return t('events.job_details_blocked', { source: source(event) })
      if (status === 'not_found') return t('events.job_details_not_found', { source: source(event) })
      if (status === 'failed') return t('events.job_details_failed', { source: source(event) })
      return t('events.job_details', { source: source(event) })
    }
    case 'job_queued':
      return t('events.job_queued', { job, source: source(event) })
    case 'job_queue_existing':
      return t('events.job_queue_existing', { job })
    case 'job_queue_excluded':
      return t('events.job_queue_excluded', { source: source(event) })
    case 'form_inspected':
      return str(meta.status) === 'inspected' || meta.status === undefined
        ? t('events.form_inspected', { job })
        : t('events.form_inspected_failed', { job })
    case 'form_filled': {
      const status = fillStatus(meta.status)
      return t('events.form_filled', { job, status: status ? t(`events.status.${status}`) : '?' })
    }
    case 'button_clicked':
      return str(meta.status) === 'clicked'
        ? t('events.button_clicked', { job, label: str(meta.label) ?? '?' })
        : t('events.button_clicked_failed', { job })
    case 'captcha_paused':
      return meta.search === true
        ? t('events.captcha_paused_search', { source: source(event) })
        : t('events.captcha_paused', { job })
    case 'captcha_resolved':
      return meta.search === true
        ? t('events.captcha_resolved_search', { source: source(event) })
        : t('events.captcha_resolved', { job })
    case 'job_failed':
      return t('events.job_failed', { job, reason: str(meta.reasonTag) ?? 'other' })
    case 'job_submitted':
      return t('events.job_submitted', { job })
    case 'job_marked_filled':
      return t('events.job_marked_filled', { job })
    case 'job_retried':
      return t('events.job_retried', { job })
    case 'job_unqueued':
      return t('events.job_unqueued', { job })
    case 'job_removed':
      return t('events.job_removed', { job })
    case 'job_excluded':
      return t('events.job_excluded', {
        source: source(event),
        by: str(meta.by) === 'agent' ? t('events.byAgent') : t('events.byUser')
      })
    case 'resume_attached':
      return t('events.resume_attached', { job, kind: str(meta.kind) === 'variant' ? t('events.tailored') : t('events.master') })
    case 'resume_variant_saved':
      return t('events.resume_variant_saved', { name: str(meta.name) ?? '?' })
    case 'resume_assigned':
      return meta.assigned === true
        ? t('events.resume_assigned', { job, name: str(meta.name) ?? '?' })
        : t('events.resume_unassigned', { job })
    case 'resume_master_saved':
      return t('events.resume_master_saved')
    case 'profile_updated': {
      const fields = Array.isArray(meta.fields) ? meta.fields.filter((f): f is string => typeof f === 'string') : []
      return t('events.profile_updated', { fields: fields.length > 0 ? fields.join(', ') : '?' })
    }
    case 'company_board_added':
      return t('events.company_board_added', { source: source(event) })
    case 'company_boards_checked':
      return t('events.company_boards_checked', { checked: num(meta.checked) ?? 0, postings: num(meta.postings) ?? 0 })
    case 'tool_call': {
      const tool = str(meta.tool) ?? '?'
      return meta.isError === true ? t('events.tool_call_error', { tool }) : t('events.tool_call', { tool })
    }
  }
}

/** Which rows read as a problem, for the timeline's tone. */
export function runEventTone(event: RunEventView): 'neutral' | 'warning' | 'danger' | 'success' {
  const meta = event.meta ?? {}
  switch (event.kind) {
    case 'job_failed':
    case 'captcha_paused':
      return 'danger'
    case 'search':
      return meta.failed === true ? 'danger' : 'neutral'
    case 'job_details':
      return str(meta.status) === 'ok' ? 'neutral' : 'warning'
    case 'form_filled':
      return str(meta.status) === 'filled' || str(meta.status) === 'edited'
        ? 'success'
        : str(meta.status) === 'partially_filled'
          ? 'warning'
          : 'danger'
    case 'form_inspected':
      return str(meta.status) === 'inspected' || meta.status === undefined ? 'neutral' : 'warning'
    case 'button_clicked':
      return str(meta.status) === 'clicked' ? 'neutral' : 'warning'
    case 'job_submitted':
    case 'captcha_resolved':
      return 'success'
    case 'tool_call':
      return meta.isError === true ? 'warning' : 'neutral'
    default:
      return 'neutral'
  }
}

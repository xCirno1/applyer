import { humanizeKey, MAX_LIST_ITEMS, parsePayload, readablePayload, toReadable, type ReadableEntry } from './toolPayloadRows'

/**
 * Per-tool knowledge for `ToolPayloadView`'s readable view, the same
 * division of labour as `toolCallSummary.ts` (one sentence per call) over
 * `toolPayloadRows.ts` (rows for any shape): where a tool's payload has a
 * shape worth more than labelled rows, this turns it into a table (a job
 * list, a form's fields), an action (open the job on the board, open the
 * posting) and the rows for whatever is left. Everything else falls
 * through to `readablePayload`, so a tool this module has no opinion on
 * still reads as rows. Shapes mirror `src/main/mcp-server/tools/*.ts`
 * results and `schemas.ts` arguments, but nothing here trusts them: a
 * missing or oddly typed field is skipped, never thrown on, since the
 * payload crossed IPC as opaque text a model's tool call produced.
 */

export type PayloadSection = 'arguments' | 'result'

/** Column ids; `ToolPayloadView` maps them to translated headings. */
export type HintColumn = 'title' | 'company' | 'location' | 'source' | 'status' | 'matchScore' | 'failure' | 'field' | 'kind' | 'required' | 'value' | 'salary'

export type HintCell =
  | { kind: 'text'; text: string; tone?: 'muted' | 'danger' }
  | { kind: 'url'; text: string; url: string }
  | { kind: 'job'; text: string; jobId: string }
  | { kind: 'bool'; value: boolean }

export interface HintTable {
  columns: HintColumn[]
  rows: HintCell[][]
  /** Rows past `MAX_LIST_ITEMS`, folded into one "and N more" line. */
  hiddenCount: number
}

export type HintAction = { kind: 'openJob'; jobId: string } | { kind: 'openUrl'; url: string }

export interface PayloadHint {
  table: HintTable | null
  rows: ReadableEntry[] | null
  actions: HintAction[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function text(value: unknown, tone?: 'muted' | 'danger'): HintCell {
  const shown = typeof value === 'number' && Number.isFinite(value) ? String(value) : (str(value) ?? '')
  return tone ? { kind: 'text', text: shown, tone } : { kind: 'text', text: shown }
}

function isHttpUrl(value: unknown): value is string {
  const raw = str(value)
  if (!raw) return false
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** The rows for every field of `value` except `omit`, so a table never hides the fields it did not cover. */
function restRows(value: Record<string, unknown>, omit: string[]): ReadableEntry[] | null {
  const rest = Object.entries(value).filter(([key]) => !omit.includes(key))
  if (rest.length === 0) return null
  return rest.map(([key, item]) => toReadable(item, humanizeKey(key), 1))
}

function table(columns: HintColumn[], items: unknown[], toRow: (item: Record<string, unknown>) => HintCell[]): HintTable {
  const rows = items
    .slice(0, MAX_LIST_ITEMS)
    .filter(isRecord)
    .map(toRow)
  return { columns, rows, hiddenCount: Math.max(0, items.length - MAX_LIST_ITEMS) }
}

/** `search_jobs` results: one row per posting, the title opening the posting itself. */
function searchJobsResult(value: Record<string, unknown>): PayloadHint | null {
  if (!Array.isArray(value.results)) return null
  const jobs = table(['title', 'company', 'location', 'source', 'salary'], value.results, (job) => [
    isHttpUrl(job.url) ? { kind: 'url', text: str(job.title) ?? job.url, url: job.url } : text(job.title),
    text(job.company),
    text(job.location),
    text(job.source),
    text(job.salaryRange)
  ])
  // `sourceOutcomes` is per-source bookkeeping the summary line already
  // folds into its warning count; `searchedSources` and `warnings` stay.
  return { table: jobs, rows: restRows(value, ['results', 'sourceOutcomes']), actions: [] }
}

/** `list_jobs` results: one row per tracked job, the title opening it on the board. */
function listJobsResult(value: Record<string, unknown>): PayloadHint | null {
  if (!Array.isArray(value.jobs)) return null
  const jobs = table(['title', 'company', 'status', 'matchScore', 'failure'], value.jobs, (job) => {
    const jobId = str(job.jobId)
    const title = str(job.title) ?? jobId ?? ''
    return [
      jobId ? { kind: 'job', text: title, jobId } : text(title),
      text(job.company),
      text(job.status),
      text(job.matchScore),
      text(job.failureTag, 'danger')
    ]
  })
  return { table: jobs, rows: restRows(value, ['jobs']), actions: [] }
}

const FIELD_KIND_KEYS = ['control', 'inputType'] as const

/** `inspect_application` results: the form's fields as a table, its buttons as rows. */
function inspectApplicationResult(value: Record<string, unknown>): PayloadHint | null {
  if (!Array.isArray(value.fields)) return null
  const fields = table(['field', 'kind', 'required', 'value'], value.fields, (field) => {
    const kind = FIELD_KIND_KEYS.map((key) => str(field[key]))
      .filter((part): part is string => part !== null)
      .join(' / ')
    const current = field.currentValue
    const currentText = Array.isArray(current) ? current.filter((v) => typeof v === 'string').join(', ') : current
    return [
      text(str(field.label) ?? field.name ?? field.fieldId),
      text(kind, 'muted'),
      { kind: 'bool', value: field.required === true },
      typeof currentText === 'boolean' ? { kind: 'bool', value: currentText } : text(currentText)
    ]
  })
  return { table: fields, rows: restRows(value, ['fields']), actions: jobActions(value) }
}

/** `fill_application` / `edit_application` arguments: the answers as a field/value table. */
function answersArguments(value: Record<string, unknown>): PayloadHint | null {
  if (!Array.isArray(value.answers)) return null
  const answers = table(['field', 'value'], value.answers, (answer) => {
    const given = answer.value
    if (typeof given === 'boolean') return [text(answer.fieldId), { kind: 'bool', value: given }]
    if (Array.isArray(given)) return [text(answer.fieldId), text(given.filter((v) => typeof v === 'string').join(', '))]
    return [text(answer.fieldId), text(given)]
  })
  return { table: answers, rows: restRows(value, ['answers']), actions: jobActions(value) }
}

/** `get_job_details` results: the sanitized HTML copy of the description is noise beside `descriptionText`; the apply link is an action. */
function jobDetailsResult(value: Record<string, unknown>): PayloadHint | null {
  if (!str(value.title) && !str(value.descriptionText)) return null
  const actions: HintAction[] = isHttpUrl(value.applicationUrl) ? [{ kind: 'openUrl', url: value.applicationUrl }] : []
  return { table: null, rows: restRows(value, ['description', 'applicationUrl']), actions }
}

/** Any payload naming a tracked job gets an "open on the board" action; `excluded` and `not found` outcomes carry no such job. */
function jobActions(value: Record<string, unknown>): HintAction[] {
  const jobId = str(value.jobId)
  if (!jobId) return []
  const status = str(value.status)
  if (status === 'excluded' || status === 'not_found') return []
  return [{ kind: 'openJob', jobId }]
}

/**
 * The readable view for one section of one tool call. Never null: with no
 * per-tool opinion (or a payload that does not match the expected shape)
 * it is the generic rows, so the caller has one thing to render.
 */
export function describePayload(toolName: string, section: PayloadSection, raw: string | null): PayloadHint {
  const fallback = (): PayloadHint => ({ table: null, rows: readablePayload(raw), actions: [] })
  const parsed = parsePayload(raw)
  if (parsed.kind !== 'json' || !isRecord(parsed.value)) return fallback()
  const value = parsed.value

  let hint: PayloadHint | null = null
  if (section === 'result') {
    switch (toolName) {
      case 'search_jobs':
        hint = searchJobsResult(value)
        break
      case 'list_jobs':
        hint = listJobsResult(value)
        break
      case 'inspect_application':
        hint = inspectApplicationResult(value)
        break
      case 'get_job_details':
        hint = jobDetailsResult(value)
        break
      default:
        hint = { table: null, rows: readablePayload(raw), actions: jobActions(value) }
    }
  } else if (toolName === 'fill_application' || toolName === 'edit_application') {
    hint = answersArguments(value)
  } else {
    hint = { table: null, rows: readablePayload(raw), actions: jobActions(value) }
  }
  return hint ?? fallback()
}

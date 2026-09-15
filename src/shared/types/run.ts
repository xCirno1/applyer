/**
 * A run is a user-bounded stretch of agent work ("start" before handing the
 * agent a task, "stop" when it is done) and everything the app observed in
 * between: searches, postings read, jobs queued, forms filled, challenges
 * hit, failures, and which site each of those came from.
 *
 * The record of a run is its events, one row per observation, and every
 * number the UI shows is folded from those (`RunStats`). Counters are never
 * stored, so a stat can be added or corrected later without a migration,
 * and a run can be replayed in the timeline exactly as it happened.
 *
 * Events carry no personal data: the job id and source are the only
 * identifiers, and `meta` holds counts, reason tags, tool names and the
 * search query. Job titles and companies are looked up from the job when
 * the timeline needs them.
 */

/** Longest user-given run name; longer input is cut, not refused. */
export const RUN_LABEL_MAX_LENGTH = 80

export interface RunRecord {
  id: string
  /** A user-given name, or null for the default "Run #n" the UI derives from `sequence`. */
  label: string | null
  /** 1-based, in start order, for the default name. */
  sequence: number
  startedAt: string
  /** Null while the run is in progress. At most one run is in progress at a time. */
  endedAt: string | null
  eventCount: number
}

export const RUN_EVENT_KINDS = [
  /** One `search_jobs` call, successful or not; `meta` has the per-source breakdown. */
  'search',
  /** One `get_job_details` call. */
  'job_details',
  /** `queue_job` put a new job on the board. */
  'job_queued',
  /** `queue_job` hit a URL already on the board. */
  'job_queue_existing',
  /** `queue_job` (or a search) hit the exclusion list. */
  'job_queue_excluded',
  /** `inspect_application` opened a form. */
  'form_inspected',
  /** A fill or edit attempt finished, in any state (`meta.status`). */
  'form_filled',
  /** `click_application_button` finished (`meta.status`). */
  'button_clicked',
  /** A verification challenge stopped a job; `meta.reason` is the challenge kind. */
  'captcha_paused',
  /** The user cleared a challenge and the job resumed. */
  'captcha_resolved',
  /** A job moved to Failed (`meta.reasonTag`, `meta.by`). */
  'job_failed',
  /** The user marked a job Submitted. */
  'job_submitted',
  /** The user marked a Queued job Filled by hand. */
  'job_marked_filled',
  /** A Failed job went back to Queued. */
  'job_retried',
  /** A Queued job was taken off the board without excluding it. */
  'job_unqueued',
  /** A completed job was removed from the board. */
  'job_removed',
  /** A URL was added to the exclusion list (`meta.by`). */
  'job_excluded',
  /** A resume was attached to a form (`meta.kind`: variant or master). */
  'resume_attached',
  /** The agent saved a resume variant (`meta.name`). */
  'resume_variant_saved',
  /** The agent assigned (`meta.assigned` true) or unassigned a variant. */
  'resume_assigned',
  /** The agent saved the master resume. */
  'resume_master_saved',
  /** The agent changed the profile (`meta.fields`). */
  'profile_updated',
  /** A company board joined the watchlist (`meta.provider`, `meta.by`). */
  'company_board_added',
  /** A batch of company boards was fetched (`meta.checked`, `meta.failed`, `meta.postings`). */
  'company_boards_checked',
  /** One MCP tool call, whatever it did (`meta.tool`, `meta.isError`, `meta.durationMs`). */
  'tool_call'
] as const

export type RunEventKind = (typeof RUN_EVENT_KINDS)[number]

export function isRunEventKind(value: string): value is RunEventKind {
  return (RUN_EVENT_KINDS as readonly string[]).includes(value)
}

export interface RunEvent {
  id: number
  runId: string
  kind: RunEventKind
  /** The job source the event is about, when it is about one. */
  source: string | null
  jobId: string | null
  meta: Record<string, unknown> | null
  createdAt: string
}

/** What `search` records per site, so a source can be judged on its own. */
export interface RunSearchSourceOutcome {
  results: number
  /** True when the site answered with a verification challenge. */
  blocked: boolean
  /** True when the search returned a warning about this site (empty, unrecognised layout, no edition). */
  warned: boolean
}

/** A type alias rather than an interface so it can be handed to `recordRunEvent` as a plain record. */
export type RunSearchMeta = {
  query: string
  location: string | null
  country: string | null
  /** Total results after cross-source dedupe. */
  results: number
  /** Sources the search actually hit, with what each returned. */
  sources: Record<string, RunSearchSourceOutcome>
  warnings: string[]
  /** Set when the whole call threw rather than returning. */
  failed: boolean
  durationMs: number
}


export interface ListRunsQuery {
  limit?: number
  offset?: number
}

export interface ListRunsResult {
  items: RunRecord[]
  total: number
}

export interface ListRunEventsQuery {
  runId: string
  kinds?: RunEventKind[]
  limit?: number
  offset?: number
}

/** A timeline row: the event plus the job it names, when that job still exists. */
export interface RunEventView extends RunEvent {
  jobTitle: string | null
  jobCompany: string | null
}

export interface ListRunEventsResult {
  items: RunEventView[]
  total: number
}

/* ---------- Folded statistics ---------- */

export interface RunSourceStats {
  source: string
  /** Searches that hit this site. */
  searches: number
  /** Results this site contributed across those searches. */
  results: number
  /** Searches where this site answered with a challenge. */
  blocked: number
  /** Searches where this site came back with a warning. */
  warned: number
  /** Postings read through `get_job_details`. */
  detailsRead: number
  detailsBlocked: number
  /** Jobs the agent queued from this site. */
  queued: number
  /** Queue attempts that were already on the board. */
  queueExisting: number
  filled: number
  submitted: number
  failed: number
  /** Jobs from this site the user excluded during the run. */
  excluded: number
}

export interface RunSearchStats {
  total: number
  failed: number
  /** Results returned across all searches, after dedupe. */
  results: number
  /** Searches that returned nothing at all. */
  empty: number
  /** Distinct queries, by text. */
  distinctQueries: number
  /** Sum of the per-site "blocked" flags. */
  blockedHits: number
  avgResults: number
  avgDurationMs: number
  /** The most recent queries, newest first. */
  recent: Array<{ query: string; location: string | null; country: string | null; results: number; at: string }>
}

export interface RunFillStats {
  inspected: number
  /** Every fill/edit attempt, whatever it returned. */
  attempts: number
  filled: number
  partiallyFilled: number
  edited: number
  failed: number
  permissionDenied: number
  noSession: number
  buttonsClicked: number
  buttonsFailed: number
  /** Fields the agent filled across successful attempts. */
  fieldsFilled: number
  fieldsSkipped: number
}

export interface RunPipelineStats {
  queued: number
  queueExisting: number
  queueExcluded: number
  submitted: number
  failed: number
  /** Failures by reason tag, most frequent first. */
  failureReasons: Array<{ reasonTag: string; count: number }>
  markedFilled: number
  retried: number
  unqueued: number
  removed: number
  excludedByUser: number
  excludedByAgent: number
  /** Match scores the agent gave the jobs it queued. */
  matchScore: { count: number; avg: number | null; min: number | null; max: number | null }
}

export interface RunCaptchaStats {
  paused: number
  resolved: number
  /** By challenge kind, most frequent first. */
  reasons: Array<{ reason: string; count: number }>
}

export interface RunResumeStats {
  attachedVariant: number
  attachedMaster: number
  variantsSaved: number
  assigned: number
  unassigned: number
  masterSaved: number
}

export interface RunMiscStats {
  profileUpdates: number
  companyBoardsAdded: number
  companyBoardChecks: number
  companyBoardsChecked: number
  companyBoardPostings: number
}

export interface RunToolStats {
  calls: number
  errors: number
  totalDurationMs: number
  /** Per tool, most called first. */
  byTool: Array<{ tool: string; calls: number; errors: number; avgDurationMs: number }>
}

export interface RunStats {
  run: RunRecord
  /** Milliseconds from start to end, or to now for a run in progress. */
  durationMs: number
  /** Events per hour of run time, a rough "how busy was the agent". */
  eventsPerHour: number
  firstEventAt: string | null
  lastEventAt: string | null
  searches: RunSearchStats
  /** Per site, in the order they first appeared. */
  sources: RunSourceStats[]
  pipeline: RunPipelineStats
  fills: RunFillStats
  captcha: RunCaptchaStats
  resumes: RunResumeStats
  misc: RunMiscStats
  tools: RunToolStats
}

export interface RunStatsQuery {
  runId: string
}

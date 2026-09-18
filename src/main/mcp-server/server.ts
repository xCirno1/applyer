import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { recordRunEvent } from '../runs/runTracker'
import { APP_VERSION } from '@shared/version'
import {
  searchJobsShape,
  getJobDetailsShape,
  queueJobShape,
  listJobsShape,
  flagFailureShape,
  getProfileShape,
  updateProfileShape,
  inspectApplicationShape,
  clickApplicationButtonShape,
  fillApplicationShape,
  editApplicationShape,
  excludeJobShape,
  addCompanyBoardShape,
  listCompanyBoardsShape,
  getResumeShape,
  setMasterResumeShape,
  saveResumeVariantShape,
  assignResumeShape,
  deleteResumeVariantShape
} from './schemas'
import { getProfileTool } from './tools/getProfile'
import { updateProfileTool } from './tools/updateProfile'
import { searchJobsTool } from './tools/searchJobs'
import { getJobDetailsTool } from './tools/getJobDetails'
import { queueJobTool } from './tools/queueJob'
import { listJobsTool } from './tools/listJobs'
import { flagFailureTool } from './tools/flagFailure'
import { inspectApplicationTool } from './tools/inspectApplication'
import { clickApplicationButtonTool } from './tools/clickApplicationButton'
import { fillApplicationTool } from './tools/fillApplication'
import { editApplicationTool } from './tools/editApplication'
import { excludeJobTool } from './tools/excludeJob'
import { addCompanyBoardTool } from './tools/addCompanyBoard'
import { listCompanyBoardsTool } from './tools/listCompanyBoards'
import { getResumeTool } from './tools/getResume'
import { setMasterResumeTool } from './tools/setMasterResume'
import { saveResumeVariantTool } from './tools/saveResumeVariant'
import { assignResumeTool } from './tools/assignResume'
import { deleteResumeVariantTool } from './tools/deleteResumeVariant'

/**
 * Every tool call lands one `tool_call` event on the run in progress (see
 * `runs/runTracker.ts`), with the tool's name, whether it answered with an
 * error and how long it took. This is the only place that sees every call,
 * so the agent's activity is counted here once rather than inside each
 * tool; the tools themselves record what they did, not that they ran.
 */
function observed<Args>(
  tool: string,
  handler: (args: Args) => CallToolResult | Promise<CallToolResult>
): (args: Args) => Promise<CallToolResult> {
  return async (args) => {
    const startedAt = Date.now()
    try {
      const result = await handler(args)
      recordRunEvent('tool_call', { meta: { tool, isError: result.isError === true, durationMs: Date.now() - startedAt } })
      return result
    } catch (err) {
      recordRunEvent('tool_call', { meta: { tool, isError: true, durationMs: Date.now() - startedAt } })
      throw err
    }
  }
}

export function createApplyerMcpServer(): McpServer {
  const server = new McpServer({ name: 'applyer', version: APP_VERSION })

  server.registerTool(
    'get_profile',
    {
      title: 'Get candidate profile',
      description:
        'The user\'s profile (contact, desired roles, skills, salary expectations) and uploaded documents. `includeDocumentText: true` adds each document\'s extracted text, the way to read the uploaded resume without a file path; leave it off for matching and form filling, it is long.',
      inputSchema: getProfileShape
    },
    observed('get_profile', getProfileTool)
  )

  server.registerTool(
    'update_profile',
    {
      title: 'Update the candidate profile',
      description:
        'Writes only the fields passed; omitted fields keep their value. List fields (skills, desiredRoles, desiredLocations) replace the stored list, so pass the full list (get_profile first to add to it). Never invent a skill, salary or location; leave a field out when unsure.',
      inputSchema: updateProfileShape
    },
    observed('update_profile', updateProfileTool)
  )

  server.registerTool(
    'search_jobs',
    {
      title: 'Search for jobs',
      description:
        'Keyword search for postings. Aggregators search every company: indeed, linkedin, seek (AU/NZ), jora (worldwide, re-lists other boards), prosple (graduate roles, Asia-Pacific), remotive (remote-only). greenhouse/lever/ashby/workday search only the company boards the user tracks (add_company_board), so with none tracked they return a warning. The user\'s country setting picks each aggregator\'s edition; `country` overrides it for one call. Defaults to every source; returns snippets, not full descriptions. A site that answers with a verification challenge is retried in a visible window for the user to clear (up to two minutes per site); a warning names any site that stayed blocked.',
      inputSchema: searchJobsShape
    },
    observed('search_jobs', searchJobsTool)
  )

  server.registerTool(
    'get_job_details',
    {
      title: 'Get full job posting details',
      description:
        'Full description, location and application info for one posting URL, routed to the right source (API or headless browser). Returns a blocked status when the site presents a verification challenge.',
      inputSchema: getJobDetailsShape
    },
    observed('get_job_details', getJobDetailsTool)
  )

  server.registerTool(
    'queue_job',
    {
      title: 'Queue a matching job',
      description:
        'Adds a posting to the user\'s board as Queued once you judged it a good match. Deduplicated by URL; a repeat reports it as existing.',
      inputSchema: queueJobShape
    },
    observed('queue_job', queueJobTool)
  )

  server.registerTool(
    'list_jobs',
    {
      title: 'List queued/tracked jobs',
      description:
        'Jobs already on the board, optionally by status. Check before searching again.',
      inputSchema: listJobsShape
    },
    observed('list_jobs', listJobsTool)
  )

  server.registerTool(
    'flag_failure',
    {
      title: 'Flag a job as failed',
      description:
        'Marks a queued or filled job Failed with a lowercase_snake_case reason tag (captcha_verification, login_required, expired_listing, or a new one, registered automatically). Use it when you cannot proceed with a job.',
      inputSchema: flagFailureShape
    },
    observed('flag_failure', flagFailureTool)
  )

  server.registerTool(
    'inspect_application',
    {
      title: 'Inspect a job application form',
      description:
        'Opens and retains a visible application form for a Queued job, or re-reads the retained form of a Queued or Filled job, and returns the current step\'s fields and recognised navigation buttons with opaque ids: label, name/placeholder/autocomplete hints, control type, current value, required, options. Ids are the identifiers; labels are context only. storedDocuments lists what a file field may name (`resume`, `cover_letter`); a resume with source variant or master is rendered from the structured resume. Password, hidden-step and final-action controls are omitted. Never changes the page.',
      inputSchema: inspectApplicationShape
    },
    observed('inspect_application', inspectApplicationTool)
  )

  server.registerTool(
    'click_application_button',
    {
      title: 'Click an application navigation button',
      description:
        'Clicks one listed navigation button (Next, Continue, Proceed, Back, Previous) by buttonId from the latest inspection. Needs the user\'s Press application buttons permission (off by default), since a site can attach any script to a button. Every click consumes that inspection\'s ids: inspect again after. Never marks the job Submitted.',
      inputSchema: clickApplicationButtonShape
    },
    observed('click_application_button', clickApplicationButtonTool)
  )

  server.registerTool(
    'fill_application',
    {
      title: 'Fill out a job application',
      description:
        'Fills the given fieldId/value pairs from the latest inspection. File value `resume` attaches the job\'s assigned variant, else the master or original upload per the user\'s setting (storedDocuments says which); `cover_letter` attaches that upload. Returns partially_filled and keeps the job Queued unless finalStep is true, which marks it Filled once every page is done; nothing submits. An empty answers list only with finalStep true on a fieldless review page. Use option values exactly as inspected. Asks the user for permission when it is not granted.',
      inputSchema: fillApplicationShape
    },
    observed('fill_application', fillApplicationTool)
  )

  server.registerTool(
    'edit_application',
    {
      title: 'Edit an open job application',
      description:
        'Updates fieldId/value pairs on the current step of the retained form, from a fresh inspection. On a Queued job the fill carries on unchanged; on a Filled job it edits the original still-open form. Never changes attachments, clicks, advances or submits.',
      inputSchema: editApplicationShape
    },
    observed('edit_application', editApplicationTool)
  )

  server.registerTool(
    'exclude_job',
    {
      title: 'Exclude a job posting',
      description:
        'Permanently blacklists a posting URL: off the board, never returned by search_jobs, cannot be re-queued. Only when the user explicitly asked to exclude, hide or stop seeing it (or postings matching stated criteria); never as your own quality filter, for that just do not queue.',
      inputSchema: excludeJobShape
    },
    observed('exclude_job', excludeJobTool)
  )

  server.registerTool(
    'add_company_board',
    {
      title: "Track a company's own job board",
      description:
        'Tracks a company\'s ATS board (Greenhouse, Lever, Ashby, Workday) so search_jobs fetches it; for companies that never post to aggregators. `company` is a name, domain or board URL; Applyer probes the providers and keeps the board with the most open roles. Pass `provider` alone as a hint when you know the ATS but not the slug, `provider` + `token` only for a known slug; Workday needs a URL. Track only companies the user asked to watch.',
      inputSchema: addCompanyBoardShape
    },
    observed('add_company_board', addCompanyBoardTool)
  )

  server.registerTool(
    'list_company_boards',
    {
      title: 'List tracked company boards',
      description:
        'The tracked company boards with each one\'s last fetch (open roles, or the error). Check before adding, and to explain an empty greenhouse/lever/ashby/workday search.',
      inputSchema: listCompanyBoardsShape
    },
    observed('list_company_boards', listCompanyBoardsTool)
  )

  server.registerTool(
    'get_resume',
    {
      title: 'Get the structured resume',
      description:
        'The master resume as structured content (header, then sections with free-text titles and a layout: text, entries, groups or list), the saved variants (name, template, stale flag, jobs using each) and resume settings. With `jobId`: that job\'s assigned variant, a diff summary against the master, and what fill_application will attach. If no master exists, says how to build one. Call before save_resume_variant (variants reuse master ids) and assign_resume.',
      inputSchema: getResumeShape
    },
    observed('get_resume', getResumeTool)
  )

  server.registerTool(
    'set_master_resume',
    {
      title: 'Set the master resume',
      description:
        'Creates or replaces the master resume, the source of every variant and (per settings) the default attachment. Build it from the uploaded resume (get_profile with includeDocumentText) or the user\'s words, transcribing every sentence as written. Section titles from the document, layout by shape, and a short stable id on every section, entry, group and contact that never changes afterwards (variants match by id; existing variants go stale).',
      inputSchema: setMasterResumeShape
    },
    observed('set_master_resume', setMasterResumeTool)
  )

  server.registerTool(
    'save_resume_variant',
    {
      title: 'Save a named resume variant',
      description:
        'Creates or replaces a named variant: the master rewritten with a focus or for one posting (`assignJobId` assigns it in the same call). Names match case-insensitively; saving an existing name updates every job using it. From get_resume and get_job_details: rewrite the summary, reorder and reword bullets in the posting\'s vocabulary, drop what does not help, regroup skills; a new text or list section is fine. Never add a job, degree, project, skill category or fact the master lacks; every entry and group keeps its master id or the call is refused; new experience goes into the master first. Plain sentences, no em dashes, no emoji. Tell the user what changed; they review the diff in Applyer.',
      inputSchema: saveResumeVariantShape
    },
    observed('save_resume_variant', saveResumeVariantTool)
  )

  server.registerTool(
    'assign_resume',
    {
      title: 'Choose which resume a job gets',
      description:
        'Points a job at an existing variant by name (several jobs can share one); no `variantName` sends it back to the default (master or original upload). Prefer this over writing a new variant when one fits. Reports what will be attached and whether the variant is stale.',
      inputSchema: assignResumeShape
    },
    observed('assign_resume', assignResumeTool)
  )

  server.registerTool(
    'delete_resume_variant',
    {
      title: 'Delete a resume variant',
      description:
        'Deletes a variant by name; its jobs return to the default attachment (the result says how many). To take a variant off one job instead, use assign_resume with no variantName.',
      inputSchema: deleteResumeVariantShape
    },
    observed('delete_resume_variant', deleteResumeVariantTool)
  )

  return server
}

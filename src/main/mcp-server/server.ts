import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
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
  listCompanyBoardsShape
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

export function createApplyerMcpServer(): McpServer {
  const server = new McpServer({ name: 'applyer', version: '0.1.0' })

  server.registerTool(
    'get_profile',
    {
      title: 'Get candidate profile',
      description:
        "Returns the user's profile (name, contact info, desired roles, skills, salary expectations, etc.) and a list of their uploaded documents (resume, cover letter). Use this to judge whether a job is a good match and to fill application forms. " +
        'Pass `includeDocumentText: true` to also get the text extracted from each of those documents. That is how you read the resume the user uploaded to Applyer without needing a file path, e.g. when they ask you to fill in a profile they left blank. Leave it off otherwise: it is a lot of text, and matching and form-filling do not need it.',
      inputSchema: getProfileShape
    },
    getProfileTool
  )

  server.registerTool(
    'update_profile',
    {
      title: 'Update the candidate profile',
      description:
        "Updates the user's stored profile. Every field is optional and only the fields you pass are written — omitted fields keep their current value, so this is safe to call with just the parts you actually know. " +
        'Use it when the user asks you to change their profile, or to fill it in from a resume they point you at (read the file yourself, then send the fields here). ' +
        'Lists (skills, desiredRoles, desiredLocations) REPLACE the stored list rather than appending, so pass the full intended list — call get_profile first if you mean to add to what is already there. ' +
        "Only write what the user's own materials or instructions support: never invent a skill, salary, or location to fill a gap, and leave a field out if you are unsure.",
      inputSchema: updateProfileShape
    },
    updateProfileTool
  )

  server.registerTool(
    'search_jobs',
    {
      title: 'Search for jobs',
      description:
        'Searches for job postings matching a query. Two kinds of source: LinkedIn and Indeed run a keyword search across every company, while greenhouse/lever/ashby/workday search the company boards the user tracks (see add_company_board / list_company_boards) — those providers have no cross-company search endpoint, so their coverage is exactly the tracked list and asking for them with nothing tracked returns a warning saying so. Defaults to all of them. Returns short snippets, not full descriptions.',
      inputSchema: searchJobsShape
    },
    searchJobsTool
  )

  server.registerTool(
    'get_job_details',
    {
      title: 'Get full job posting details',
      description:
        'Fetches the full description, location, and application info for a single job posting URL. Routes to the right source automatically (Greenhouse/Lever/Ashby use their public APIs; LinkedIn/Indeed/Workday/generic sites are read via a headless browser). May return a "blocked" status if the site presents a verification challenge.',
      inputSchema: getJobDetailsShape
    },
    getJobDetailsTool
  )

  server.registerTool(
    'queue_job',
    {
      title: 'Queue a matching job',
      description:
        "Adds a job posting to the user's task board in the Queued state, so they can review it in the app. Call this after you've decided a job is a good match. Deduplicated by URL — calling this again for the same URL is safe and just reports it as already existing.",
      inputSchema: queueJobShape
    },
    queueJobTool
  )

  server.registerTool(
    'list_jobs',
    {
      title: 'List queued/tracked jobs',
      description: "Lists jobs already on the user's task board, optionally filtered by status. Useful for checking what's already been queued before searching again.",
      inputSchema: listJobsShape
    },
    listJobsTool
  )

  server.registerTool(
    'flag_failure',
    {
      title: 'Flag a job as failed',
      description:
        'Marks a queued or filled job as Failed with a reason tag (e.g. "captcha_verification", "login_required", "expired_listing", or any new lowercase_snake_case tag — unrecognized tags are registered automatically). Use this when you cannot proceed with a job for some reason.',
      inputSchema: flagFailureShape
    },
    flagFailureTool
  )

  server.registerTool(
    'inspect_application',
    {
      title: 'Inspect a job application form',
      description:
        'Opens and retains a visible application form for a Queued job, then returns every supported field and explicitly recognized navigation button on the current visible step with opaque IDs. Fields include semantic labels, raw name/placeholder/autocomplete hints, control type, current value, required state, and available options. Password, hidden-step, arbitrary action, and final-action controls are omitted. A retained multi-step fill stays Queued and in fill mode across pages, including later document-upload steps. A Filled job can only re-inspect its original still-open form for editing. Labels and hints are context only and must never be used as identifiers. Inspection never changes the page or submits the application.',
      inputSchema: inspectApplicationShape
    },
    inspectApplicationTool
  )

  server.registerTool(
    'click_application_button',
    {
      title: 'Click an application navigation button',
      description:
        'With the user\'s Press application buttons permission, clicks one visible, enabled navigation-like button in the retained application window using a buttonId from the latest inspect_application result. Only Next, Continue, Proceed, Back, or Previous labels are listed, but a site may attach an arbitrary or irreversible script to any button, so the permission is disabled by default. Every inspected buttonId is consumed by a click and clicks are serialized, so inspect again afterward. Native form submission is blocked while the click is dispatched, but site scripts can use other mechanisms. This tool never marks the Applyer job Submitted.',
      inputSchema: clickApplicationButtonShape
    },
    clickApplicationButtonTool
  )

  server.registerTool(
    'fill_application',
    {
      title: 'Fill out a job application',
      description:
        'Fills only the fieldId/value pairs supplied from the latest inspect_application result. By default it returns partially_filled and keeps the job Queued so later pages, including document-upload steps, remain fillable. Set finalStep to true only when every application page is complete and the retained form is ready for user review; that moves the job to Filled but never clicks or submits the ATS form. An empty answers list is accepted only for finalStep true, for a fieldless final review page. Never target a field by label. Use option values exactly as inspected. If permission is disabled, Applyer asks the user before changing the form.',
      inputSchema: fillApplicationShape
    },
    fillApplicationTool
  )

  server.registerTool(
    'edit_application',
    {
      title: 'Edit an open job application',
      description:
        'Updates only fieldId/value pairs from a fresh inspection of the original visible form retained for a Filled job. Labels are semantic context only. It never opens a replacement session, changes document attachments, clicks buttons, advances the form, or submits it. The user reviews every changed answer before submitting.',
      inputSchema: editApplicationShape
    },
    editApplicationTool
  )

  server.registerTool(
    'exclude_job',
    {
      title: 'Exclude a job posting',
      description:
        "Permanently blacklists a job posting URL: it's removed from the board if currently tracked, will never be returned by search_jobs again, and can't be re-queued. " +
        'ONLY call this when the user has explicitly asked to exclude, blacklist, hide, or stop seeing a specific posting or postings matching some stated criteria (e.g. "put job postings that are not remote on the exclusion list", "exclude that one", "I never want to see Foo Corp jobs again"). ' +
        "Do NOT call this on your own judgment just because you think a job is a bad match — for that, simply don't queue it. Excluding is a standing, permanent instruction from the user, not a quality filter you apply yourself.",
      inputSchema: excludeJobShape
    },
    excludeJobTool
  )

  server.registerTool(
    'add_company_board',
    {
      title: "Track a company's own job board",
      description:
        "Adds a company's ATS board (Greenhouse, Lever, Ashby or Workday) to the list search_jobs fetches, so that company's postings are searchable even though it never posts to LinkedIn or Indeed — which is common for smaller and earlier-stage companies. " +
        'Pass `company` as a name ("Acme Labs"), a domain ("acme.com"), or a board URL; Applyer probes the providers and keeps the board with the most open roles rather than the first one that answers, because a company that migrated ATS often leaves the old, empty board live. ' +
        'Pass `provider` + `token` together only if you already know the exact slug. If your search established which ATS the company uses but not the slug, pass `provider` on its own: it is used as a preference, and a provider that actually has postings still wins over it. A Workday board can only be added by URL — it needs a host, tenant and site, not a single token. ' +
        'Use this when the user names companies they want watched, or when you have found the board of a company they are interested in. Adding a board is a standing instruction that costs one request per search, so add companies the user actually wants, not every company you come across.',
      inputSchema: addCompanyBoardShape
    },
    addCompanyBoardTool
  )

  server.registerTool(
    'list_company_boards',
    {
      title: 'List tracked company boards',
      description:
        "Lists the company ATS boards search_jobs will fetch, with the result of each one's last fetch (open roles, or the error if it stopped answering). Check this before adding boards to avoid duplicates, and to explain why a greenhouse/lever/ashby/workday search returned nothing.",
      inputSchema: listCompanyBoardsShape
    },
    listCompanyBoardsTool
  )

  return server
}

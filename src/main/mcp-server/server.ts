import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  searchJobsShape,
  getJobDetailsShape,
  queueJobShape,
  listJobsShape,
  flagFailureShape,
  getProfileShape,
  updateProfileShape,
  fillApplicationShape,
  excludeJobShape
} from './schemas'
import { getProfileTool } from './tools/getProfile'
import { updateProfileTool } from './tools/updateProfile'
import { searchJobsTool } from './tools/searchJobs'
import { getJobDetailsTool } from './tools/getJobDetails'
import { queueJobTool } from './tools/queueJob'
import { listJobsTool } from './tools/listJobs'
import { flagFailureTool } from './tools/flagFailure'
import { fillApplicationTool } from './tools/fillApplication'
import { excludeJobTool } from './tools/excludeJob'

export function createApplyerMcpServer(): McpServer {
  const server = new McpServer({ name: 'applyer', version: '0.1.0' })

  server.registerTool(
    'get_profile',
    {
      title: 'Get candidate profile',
      description:
        "Returns the user's profile (name, contact info, desired roles, skills, salary expectations, etc.) and a list of their uploaded documents (resume, cover letter). Use this to judge whether a job is a good match and to fill application forms.",
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
        'Searches for job postings matching a query. Currently searches LinkedIn and Indeed (the only sources with cross-company keyword search); Greenhouse/Lever/Ashby/Workday are per-company boards with no search endpoint — pass a specific company career-page URL to get_job_details instead. Returns short snippets, not full descriptions.',
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
    'fill_application',
    {
      title: 'Fill out a job application',
      description:
        "Opens a visible browser window and fills in the standard fields of a queued job's application form (name, email, phone, location, LinkedIn/GitHub/portfolio links, resume/cover-letter upload) using the candidate's profile — but NEVER submits it. The user reviews and submits it themselves. Custom essay/eligibility questions are left blank for the user. If the site presents a verification challenge, returns a 'paused_captcha' status immediately (it does not block waiting for the user) — the fill resumes automatically once they resolve it.",
      inputSchema: fillApplicationShape
    },
    fillApplicationTool
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

  return server
}

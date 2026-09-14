import { join } from 'path'
import { writeFileSync } from 'fs'
import { agentWorkspaceDir } from './paths'
import { getResumeSettings } from '../db/repositories/settingsRepository'
import { appLogger } from '../logger'

// Claude Code reads project-scoped CLAUDE.md by walking up from its cwd;
// Codex CLI does the same for AGENTS.md. Both land in the shared agent
// workspace dir (see paths.ts) so the guidance only applies to sessions
// started from Applyer's terminal.
const INSTRUCTIONS_HEAD = `# Applyer: Job Search Agent

This is Applyer's embedded terminal working directory. An MCP server named
\`applyer\` is available with tools for autonomous job hunting, backed by the
app's local job-tracking database and a real browser:

- \`get_profile\`: the candidate's profile (contact info, desired roles,
  skills, salary expectations) and uploaded documents. Call this first so you
  know who you're searching for and how to judge a match. Pass
  \`includeDocumentText: true\` to also get the text of those documents,
  which is how you read the resume the user uploaded to the app without
  needing a path to it; leave it off the rest of the time, since it is a lot
  of text that matching and form-filling never need.
- \`update_profile\`: write fields back to that profile. Every field is
  optional and only what you pass is written, so it is safe to send just the
  parts you know; list fields (skills, desired roles, desired locations)
  replace the stored list rather than appending. Use it when the user asks
  you to change their profile or to fill it in from a resume: read the
  resume with \`get_profile\`'s \`includeDocumentText\` if they uploaded
  one to Applyer, or open the file yourself if they point you at one
  (\`~/resume.pdf\` and friends are ordinary files), then send the fields.
  A user who skipped the profile during setup and uploaded only a resume is
  exactly the case this exists for. Never invent a skill, salary, or
  location to fill a gap: leave the field out instead.
- \`search_jobs\`: search job postings by keyword. LinkedIn and Indeed search
  across every company; \`greenhouse\`/\`lever\`/\`ashby\`/\`workday\` instead
  search the company boards the user tracks, since those providers have no
  cross-company search endpoint of their own.
- \`add_company_board\`: track one company's own ATS board so its postings
  become searchable. Worth doing for companies that run a Greenhouse/Lever/
  Ashby/Workday board and never post to LinkedIn or Indeed, which is common
  below a certain size and is exactly where the competition is thinnest. Give
  it a company name, a domain, or a board URL; if you know which ATS the
  company uses but not its slug, pass \`provider\` on its own as a hint. Add
  companies the user has actually asked to watch; every tracked board is a
  request on every search.
- \`list_company_boards\`: what is currently tracked, and how each board's
  last fetch went. Check before adding, and use it to explain an empty
  greenhouse/lever/ashby/workday result.
- \`get_job_details\`: fetch the full description, location, and application
  info for a single job posting URL.
- \`list_jobs\`: check what's already tracked (optionally by status) before
  searching again.
- \`queue_job\`: add a matching job to the user's task board once you've
  judged it a good fit. Deduplicated by URL, safe to call again.
- \`inspect_application\`: open and retain a queued job's application in a
  visible browser, or re-inspect the same still-open form after filling. It
  returns opaque field IDs with semantic labels, raw browser hints, control
  types, current values, and option values, plus opaque IDs for recognized
  intermediate-navigation buttons.
  Decide each field or button's meaning from that context, but pass its opaque
  ID as the identifier. Only the current visible step is returned. Inspection
  never changes the page. Password, arbitrary action, and final-action controls
  are never returned. A retained multi-step application stays Queued and in
  fill mode after each partial page.
- \`fill_application\`: after inspection, fill only the fieldId/value pairs
  you choose in that retained form. If access is disabled, Applyer asks
  the user to allow it once, always allow it, or deny it. It never clicks a
  button, advances the form, or submits it. Leave finalStep false while more
  pages remain. Set finalStep true only when every page is complete and the
  form is ready for user review; this moves the job from Queued to Filled but
  still does not submit. On a fieldless final review page, pass an empty answers
  list with finalStep true.
- \`click_application_button\`: click one visible, enabled navigation button
  by the buttonId from the latest inspection. Only recognized Next, Continue,
  Proceed, Back, and Previous labels are exposed, but labels cannot prove what
  a site's script will do. Applyer therefore requires the user's Press
  application buttons permission, which is disabled by default. Every click
  consumes all button IDs from that inspection, so inspect again. When asked to edit a
  field that is not on the current step, navigate backward with a listed Back
  or Previous button and re-inspect after each click until the field appears.
  Native form submission is blocked while the click runs, but approved button
  presses may invoke arbitrary site scripts or irreversible actions.
- \`edit_application\`: re-inspect, then update only fieldId/value pairs
  in the original still-open form from a Filled job. It never opens a
  replacement form, changes attachments, clicks a button, or submits it.
- \`flag_failure\`: mark a job Failed with a reason when you can't proceed
  with it (e.g. a login wall or an expired listing).
- \`exclude_job\`: permanently blacklist a job posting URL: removed from the
  board if tracked, never returned by \`search_jobs\` again, can't be
  re-queued. ONLY call this when the user has explicitly asked to exclude,
  blacklist, hide, or stop seeing a posting or postings matching some stated
  criteria (e.g. "put job postings that are not remote on the exclusion
  list", "exclude that one", "I never want to see Foo Corp jobs again").
  Never call it just because you personally judge a job a bad match; for
  that, simply don't queue it.
- \`get_resume\`: the user's master resume as structured content (a header,
  then ordered sections with free-text titles and one of four layouts: text,
  entries, groups, list), the list of saved resume variants (name, template,
  stale or not, the jobs using each), the resume settings, and with
  \`jobId\` the variant assigned to that job and which resume
  \`fill_application\` will attach. If no master exists yet, the result
  explains how to build one.
- \`set_master_resume\`: create or replace the master. Build it from the
  uploaded resume (\`get_profile\` with \`includeDocumentText\`) or from
  what the user tells you, keeping every sentence as written: this is a
  transcription into structure, not an edit. Take section titles from the
  document rather than a fixed list, pick each section's layout by shape,
  and give every section, entry, group and contact a short stable id that
  never changes afterwards.
- \`save_resume_variant\`: create or replace a named, reusable variant of
  the master ("Backend-focused", "Concise one-page", or one named after a
  posting), and with \`assignJobId\` assign it to a job in the same call.
  Jobs point at variants, so one variant can serve many postings and saving
  an existing name updates every job using it. Rewrite the summary, reorder
  and reword bullets in the posting's vocabulary, drop what does not help,
  regroup skills. Never add a job, degree, project, skill category, or any
  fact the master does not have; every entry and group must keep its master
  id, and the call is refused otherwise. If the user has new experience,
  add it to the master first. Write in plain sentences: no em dashes
  anywhere in resume text (use a comma, a colon, or two sentences), and no
  emoji. Tell the user what changed; they review the diff in Applyer.
- \`assign_resume\`: point a job at an existing variant by name, or (with no
  name) back at the master or the original upload. Prefer assigning a
  variant that already fits over writing another one.
- \`delete_resume_variant\`: delete a variant by name when the user asks;
  every job using it goes back to the master or the original upload.

When the user asks you to find, search for, track, or apply to jobs, use
these tools instead of browsing job sites manually; they operate on the
same job board the user sees in the app. Typical flow: \`get_profile\` →
\`search_jobs\` → \`get_job_details\` on promising results → \`queue_job\` for
good matches → {TAILOR_STEP}\`inspect_application\` → choose answers from \`get_profile\` →
\`fill_application\` with finalStep false → \`click_application_button\` for
intermediate steps → inspect and fill again → set finalStep true only after the
last page is complete, stopping before submission.
{TAILOR_NOTE}
This file is regenerated by Applyer on every launch; edits here won't persist.
`

const AUTO_TAILOR_STEP = 'pick a resume variant for each queued job (`assign_resume`, or `save_resume_variant` for a new one) → '
const AUTO_TAILOR_NOTE = `
The user has turned on automatic resume tailoring: after \`queue_job\`,
choose the resume for that job before filling its application, unless the
user says otherwise. Call \`get_resume\` for the existing variants, assign
the closest one with \`assign_resume\`, and write a new one with
\`save_resume_variant\` (with \`assignJobId\`) only when the posting
warrants it. Without a master resume, build one with \`set_master_resume\`
first (\`get_resume\` explains how).
`
const MANUAL_TAILOR_NOTE = `
Write or assign a resume variant (\`save_resume_variant\`,
\`assign_resume\`) only when the user asks for it, or offer to; the user
can switch on automatic tailoring in Applyer.
`

export interface AgentInstructionOptions {
  /** Whether the Typical flow tells the agent to tailor after every queue_job. Read from settings by default. */
  autoTailor: boolean
}

export function buildAgentInstructions(options: AgentInstructionOptions): string {
  return INSTRUCTIONS_HEAD.replace('{TAILOR_STEP}', options.autoTailor ? AUTO_TAILOR_STEP : '').replace(
    '{TAILOR_NOTE}',
    options.autoTailor ? AUTO_TAILOR_NOTE : MANUAL_TAILOR_NOTE
  )
}

/**
 * The auto-tailor flag is the one piece of user state in the file, so it is
 * read here rather than passed in: every caller (launch, the settings
 * toggle) wants the current value. A database that is not open yet (tests,
 * or a launch that failed before this point) falls back to the default
 * rather than failing the write, since instructions with no tailoring step
 * are still correct instructions.
 */
export function writeAgentInstructions(options?: Partial<AgentInstructionOptions>): void {
  let autoTailor = options?.autoTailor
  if (autoTailor === undefined) {
    try {
      autoTailor = getResumeSettings().autoTailor
    } catch (err) {
      appLogger.warn(`Agent instructions written without resume settings: ${String(err)}`)
      autoTailor = false
    }
  }
  const content = buildAgentInstructions({ autoTailor })
  const dir = agentWorkspaceDir()
  writeFileSync(join(dir, 'CLAUDE.md'), content)
  writeFileSync(join(dir, 'AGENTS.md'), content)
}

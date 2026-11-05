import { join } from 'path'
import { writeFileSync } from 'fs'
import { agentWorkspaceDir } from './paths'
import { getResumeSettings, getStorageMode } from '../db/repositories/settingsRepository'
import { appLogger } from '../logger'
import { buildCustomInstructionsSection } from '@shared/types/customSystemPrompt'
import { readCustomSystemPromptForAgent } from './customSystemPrompt'

// Claude Code reads project-scoped CLAUDE.md by walking up from its cwd;
// Codex CLI does the same for AGENTS.md. Both land in the shared agent
// workspace dir (see paths.ts) so the guidance only applies to sessions
// started from Applyer's terminal.
//
// The file is deliberately split in three: `APP_HEAD` and `APP_TAIL` are
// terminal-specific framing (this is a working directory an MCP server is
// available in; this file is regenerated), while the tool-by-tool guide in
// between is not about the terminal at all, it is what any agent calling
// these MCP tools needs to know regardless of how it is hosted. OpenRouter
// chat mode (`openrouter/systemPrompt.ts`) calls those same tools
// in-process rather than over stdio, from inside a chat panel rather than a
// terminal, so it reuses `buildAgentToolGuide` and wraps it in its own
// framing instead of duplicating the tool descriptions a second time.
const APP_HEAD = `# Applyer: Job Search Agent

This is Applyer's embedded terminal working directory. An MCP server named
\`applyer\` is available with tools for autonomous job hunting, backed by the
app's local job-tracking database and a real browser:

`

const TOOL_GUIDE_TEMPLATE = `Each tool's own description has the full contract; this is the judgement
that goes with them.

Profile
- \`get_profile\`: who you are searching for; call it first. Add
  \`includeDocumentText: true\` only to read the uploaded resume (it is long).
- \`update_profile\`: writes only the fields you pass; list fields replace
  the stored list. Never invent a skill, salary or location: leave it out.

Finding jobs
- \`search_jobs\`: aggregators (indeed, linkedin, seek, jora, prosple,
  remotive) search everywhere; greenhouse/lever/ashby/workday search only the
  company boards the user tracks. \`country\` overrides the user's setting
  for one call.
- \`add_company_board\` / \`list_company_boards\`: track a company's own ATS
  board so its postings become searchable; list before adding, and only track
  companies the user asked to watch.
- \`get_job_details\` for the full posting, \`list_jobs\` for what is already
  on the board, \`queue_job\` for a good match (deduplicated by URL).

Applying
- \`inspect_application\`: opens or re-reads the retained form and returns
  the current step's fields and navigation buttons with opaque ids. Ids are
  the identifiers, labels are context. Never changes the page.
- \`fill_application\`: fill chosen fieldId/value pairs. Leave finalStep
  false while pages remain; true only when every page is done, which marks
  the job Filled and still does not submit. Applyer asks the user for
  permission when it is not granted.
- \`click_application_button\`: one listed Next/Continue/Proceed/Back/
  Previous button; needs the user's Press application buttons permission;
  inspect again after every click. To change a field on an earlier step,
  navigate backward with Back/Previous and re-inspect after each click.
- \`edit_application\`: correct fieldId/value pairs on the current step of a
  Queued (fill in progress) or Filled job. Never touches attachments,
  advances, or submits.
- \`flag_failure\`: mark a job Failed with a reason when you cannot proceed.
- \`exclude_job\`: a permanent blacklist. Only when the user explicitly asks
  to exclude, hide or stop seeing something; never as your own quality
  filter, for that simply do not queue.

Resumes
- \`get_resume\`: the master (header, then sections of layout text,
  entries, groups or list), the saved variants with their jobs, and with
  \`jobId\` what will be attached. Call it before writing or assigning.
- \`set_master_resume\`: create or replace the master from the uploaded
  resume or the user's words. Transcribe, do not edit; keep the document's
  own section titles; give every section, entry, group and contact a short
  stable id that never changes.
- \`save_resume_variant\`: a named rewrite of the master for a focus or a
  posting (\`assignJobId\` assigns it in the same call). Rewrite the summary,
  reorder and reword in the posting's vocabulary, drop what does not help.
  Never add a job, degree, project, skill category or fact the master lacks,
  and keep master ids (the call is refused otherwise); new experience goes
  into the master first. Plain sentences, no em dashes, no emoji. Tell the
  user what changed.
- \`assign_resume\`: point a job at an existing variant (prefer this over a
  new one), or with no name back to the default. \`delete_resume_variant\`
  only on request; its jobs fall back to the default.

Flow
Use these tools rather than browsing job sites yourself; they work on the
board the user sees. Typical: \`get_profile\` → \`search_jobs\` →
\`get_job_details\` on promising results → \`queue_job\` for good matches →
{TAILOR_STEP}\`inspect_application\` → answers from \`get_profile\` →
\`fill_application\` with finalStep false → \`click_application_button\`
between steps → inspect and fill again → finalStep true after the last page.
Nothing here submits: the user reviews and submits every application.
{TAILOR_NOTE}
`

const APP_TAIL = `This file is regenerated by Applyer on every launch; edits here won't persist.
`

const AUTO_TAILOR_STEP = 'pick a resume variant for each queued job (`assign_resume`, or `save_resume_variant` for a new one) → '
const AUTO_TAILOR_NOTE = `
The user has turned on automatic resume tailoring: after \`queue_job\` and
before filling, assign the closest existing variant (\`get_resume\`,
\`assign_resume\`), or write a new one with \`save_resume_variant\`
(\`assignJobId\`) when the posting warrants it. With no master yet, build
one with \`set_master_resume\` first.
`
const MANUAL_TAILOR_NOTE = `
Write or assign a resume variant only when the user asks, or offer to; they
can switch on automatic tailoring in Applyer.
`

export interface AgentInstructionOptions {
  /** Whether the Typical flow tells the agent to tailor after every queue_job. Read from settings by default. */
  autoTailor: boolean
}

export interface AgentInstructionFileOptions extends AgentInstructionOptions {
  /** The user's custom instructions (already normalized); absent or `''` for none. */
  customPrompt?: string
  /**
   * Whether the custom instructions may be written into the file itself.
   * False in encrypted storage mode: the file is plaintext on disk, so the
   * text goes only through the MCP server's `instructions` (sent over the
   * socket at connect time, never written anywhere) and the file says so.
   * Defaults to false, failing closed.
   */
  embedCustomPrompt?: boolean
}

const CUSTOM_PROMPT_VIA_MCP_NOTE = `
## The user's custom instructions

The user has written custom instructions for you in Applyer's Settings >
Agent. Applyer's storage is encrypted, so they are not written to this file:
they arrive with the \`applyer\` MCP server's instructions. Follow them.
`

/**
 * The tool-by-tool guide shared by the CLI terminal instructions and the
 * OpenRouter chat system prompt (`openrouter/systemPrompt.ts`'s
 * `buildChatSystemPrompt`): every MCP tool by name, what it does, and the
 * `{TAILOR_STEP}`/`{TAILOR_NOTE}` placeholders resolved against whether
 * automatic resume tailoring is on. Exported so both callers can build it
 * once rather than agentInstructions.ts restating the tool list and chat
 * mode restating it again out of sync.
 */
export function buildAgentToolGuide(options: AgentInstructionOptions): string {
  return TOOL_GUIDE_TEMPLATE.replace('{TAILOR_STEP}', options.autoTailor ? AUTO_TAILOR_STEP : '').replace(
    '{TAILOR_NOTE}',
    options.autoTailor ? AUTO_TAILOR_NOTE : MANUAL_TAILOR_NOTE
  )
}

export function buildAgentInstructions(options: AgentInstructionFileOptions): string {
  const hasCustom = !!options.customPrompt && buildCustomInstructionsSection(options.customPrompt) !== ''
  const custom = hasCustom && options.customPrompt
    ? options.embedCustomPrompt
      ? buildCustomInstructionsSection(options.customPrompt)
      : CUSTOM_PROMPT_VIA_MCP_NOTE
    : ''
  // The guide already ends on a blank line, so the section drops its own
  // leading one and adds one after itself to keep the tail separated.
  return APP_HEAD + buildAgentToolGuide(options) + (custom ? custom.replace(/^\n/, '') + '\n' : '') + APP_TAIL
}

/**
 * The MCP server's \`instructions\` (sent to every CLI client in the
 * initialize handshake), or \`undefined\` when the user has written none,
 * so a server with nothing to add advertises nothing. This is the channel
 * that reaches a CLI agent started outside the agent workspace (where the
 * instruction file is not read) and, in encrypted storage mode, the only
 * channel the custom text takes at all. Read fresh per connection, so a
 * newly started CLI session always sees the latest saved text.
 */
export function buildMcpServerInstructions(customPrompt: string): string | undefined {
  const section = buildCustomInstructionsSection(customPrompt)
  if (!section) return undefined
  return `Applyer's MCP server: tools for finding jobs, tracking them on the user's board, filling applications in a real browser, and writing resume variants. Nothing here submits an application; the user reviews and submits every one.
${section}`
}

/**
 * The auto-tailor flag and the custom instructions are the user state in
 * the file, so they are read here rather than passed in: every caller
 * (launch, the settings toggles, an import, a storage-mode change) wants
 * the current values. The storage mode decides whether the custom text is
 * embedded; an unknown mode counts as encrypted, failing closed. A database that is not open yet (tests,
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
  const customPrompt = readCustomSystemPromptForAgent()
  let embedCustomPrompt = false
  try {
    embedCustomPrompt = getStorageMode() === 'plaintext'
  } catch (err) {
    appLogger.warn(`Agent instructions written without the storage mode: ${String(err)}`)
  }
  const content = buildAgentInstructions({ autoTailor, customPrompt, embedCustomPrompt })
  const dir = agentWorkspaceDir()
  writeFileSync(join(dir, 'CLAUDE.md'), content)
  writeFileSync(join(dir, 'AGENTS.md'), content)
}

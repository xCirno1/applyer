import type { AppError } from './errorCodes'

/**
 * The user's own instructions for the Applyer agent (Settings > Agent >
 * Custom instructions), appended after the built-in prompt in both agent
 * modes: the OpenRouter chat's system message and, for a CLI agent, the
 * workspace `CLAUDE.md`/`AGENTS.md` plus the MCP server's `instructions`.
 *
 * Shared between renderer and main so the editor's counter and the IPC
 * handler refuse the same text for the same reason. The cap exists because
 * this text rides along on every chat turn and every MCP handshake: a few
 * pages of instructions is plenty, while an accidental paste of a whole
 * document would quietly eat the model's context window on every request.
 */
export const CUSTOM_SYSTEM_PROMPT_MAX_LENGTH = 8000

/** What `settings:getCustomSystemPrompt` and `settings:setCustomSystemPrompt` answer with. */
export type CustomSystemPromptResult = { ok: true; prompt: string } | { ok: false; error: AppError }

export type CustomSystemPromptParseResult =
  { ok: true; value: string } | { ok: false; reason: 'notString' | 'tooLong'; length?: number }

// C0 controls other than tab (\x09) and newline (\x0A), plus DEL. A carriage
// return is folded into a newline first, so it never reaches this filter.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\x00-\x08\x0B-\x1F\x7F]/g

/**
 * Normalizes untrusted input into the stored form: line endings folded to
 * `\n`, control characters stripped, trailing whitespace on each line and
 * surrounding blank lines trimmed. An empty result is valid and means "no
 * custom instructions". The length cap is checked after normalization so a
 * pasted CRLF file is not refused for characters that are never stored.
 */
export function parseCustomSystemPrompt(value: unknown): CustomSystemPromptParseResult {
  if (typeof value !== 'string') return { ok: false, reason: 'notString' }
  const normalized = value
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARACTERS, '')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .trim()
  if (normalized.length > CUSTOM_SYSTEM_PROMPT_MAX_LENGTH) {
    return { ok: false, reason: 'tooLong', length: normalized.length }
  }
  return { ok: true, value: normalized }
}

const OPEN_TAG = '<user_instructions>'
const CLOSE_TAG = '</user_instructions>'
const TAG_PATTERN = /<\/?\s*user_instructions\s*>/gi

/**
 * The delimited block appended after the built-in prompt, or `''` when there
 * is nothing to append (so callers can concatenate unconditionally). The
 * text is fenced in tags and any copy of those tags inside it is removed,
 * so the user's text can never appear to close its own block early and be
 * read as part of the built-in prompt. The heading tells the agent where
 * the text came from and that the built-in safety rules (nothing submits an
 * application) still stand; within those, the user's instructions win.
 * Expects text that already went through `parseCustomSystemPrompt`.
 */
export function buildCustomInstructionsSection(prompt: string): string {
  const body = prompt.replace(TAG_PATTERN, '').trim()
  if (!body) return ''
  return `
## The user's custom instructions

The user wrote the instructions below in Applyer's Settings > Agent. Follow them for how you search, match, fill and write. They do not override the rules above: nothing you do submits an application, and the tools' own limits and permissions still apply.

${OPEN_TAG}
${body}
${CLOSE_TAG}
`
}

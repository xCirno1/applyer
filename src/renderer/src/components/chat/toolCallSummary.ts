import type { ChatToolCall } from '@shared/types/chat'

/**
 * One human sentence per tool call, read off its raw JSON arguments/result
 * strings - both of which cross the IPC boundary as opaque text (see
 * `ChatToolCall` in `shared/types/chat.ts`), so nothing here trusts them to
 * parse or to have the shape a given tool normally produces. Argument
 * shapes mirror `src/main/mcp-server/schemas.ts` (the zod shapes the tools
 * themselves validate against); result shapes mirror what
 * `src/main/mcp-server/tools/*.ts` actually returns via `jsonResult`. A tool
 * this build doesn't recognise, or a payload that doesn't parse, falls back
 * to something safe rather than throwing.
 */

function parseJsonObject(text: string | null): Record<string, unknown> | null {
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function hostOf(url: unknown): string | null {
  const raw = asString(url)
  if (!raw) return null
  try {
    return new URL(raw).host
  } catch {
    return null
  }
}

/** A short present-progressive sentence describing what a tool call is doing, from its (possibly malformed) arguments. */
export function summarizeToolCall(call: ChatToolCall): string {
  const args = parseJsonObject(call.arguments)

  switch (call.name) {
    case 'search_jobs': {
      const query = args ? asString(args.query) : null
      if (!query) return 'search_jobs'
      const sources = args ? asStringArray(args.sources) : []
      return sources.length > 0 ? `Searching "${query}" on ${sources.join(', ')}` : `Searching "${query}"`
    }

    case 'queue_job': {
      const title = args ? asString(args.title) : null
      const company = args ? asString(args.company) : null
      if (title && company) return `${title} at ${company}`
      return title ?? company ?? 'queue_job'
    }

    case 'get_job_details': {
      const host = args ? hostOf(args.url) : null
      return host ? `Fetching ${host}` : 'get_job_details'
    }

    case 'fill_application': {
      const count = args && Array.isArray(args.answers) ? args.answers.length : 0
      const finalStep = args ? args.finalStep === true : false
      const fields = `${count} field${count === 1 ? '' : 's'}`
      return finalStep ? `Filling ${fields} (final step)` : `Filling ${fields}`
    }

    case 'exclude_job': {
      const title = args ? asString(args.title) : null
      return title ? `Excluding "${title}"` : 'exclude_job'
    }

    default:
      return call.name
  }
}

/** A short past-tense sentence from a recognised tool's result shape, or `''` when the shape isn't recognised - never a raw JSON dump. */
export function summarizeToolResult(call: ChatToolCall): string {
  if (call.status !== 'done' && call.status !== 'error') return ''
  if (call.isError) return ''

  const result = parseJsonObject(call.result)
  if (!result) return ''

  switch (call.name) {
    case 'search_jobs': {
      if (!Array.isArray(result.results)) return ''
      const count = result.results.length
      const warnings = Array.isArray(result.warnings) ? result.warnings.length : 0
      const resultsText = `${count} result${count === 1 ? '' : 's'}`
      return warnings > 0 ? `${resultsText}, ${warnings} warning${warnings === 1 ? '' : 's'}` : resultsText
    }

    case 'queue_job': {
      const status = asString(result.status)
      if (status === 'queued') return 'Queued'
      if (status === 'existing') return 'Already tracked'
      if (status === 'excluded') return 'Excluded'
      return ''
    }

    default:
      return ''
  }
}

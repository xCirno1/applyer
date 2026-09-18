/**
 * The plain-module half of `ToolPayloadView` (named for what it builds:
 * a file differing from the component only by case would collide on
 * Windows and macOS, and `packagingConfig.test.ts` checks for that). Turns a tool call's raw
 * arguments or result string into a tree the component can lay out as
 * labelled rows, plus the remembered Readable/JSON preference. Nothing here
 * knows which tool produced the payload: `toolCallSummary.ts` is where
 * per-tool knowledge lives, and it gives one sentence, not a view. This
 * side is deliberately shape-agnostic so a tool this build has never seen,
 * or one whose result schema changes, still reads as rows rather than
 * falling back to JSON or (worse) throwing on an unexpected value. Every
 * cap below exists because a result is untrusted text of any size
 * (`get_profile` can carry a whole resume, `search_jobs` hundreds of rows)
 * and the view has to stay cheap to build on each render.
 */

export type PayloadView = 'readable' | 'json'

const PREFERENCE_KEY = 'chat:toolPayloadView:v1'

/** Items past this in one array are folded into a single "and N more" row. */
export const MAX_LIST_ITEMS = 50
/** Nesting deeper than this is shown as its JSON text, not more rows. */
export const MAX_DEPTH = 6
/** A string at or past this length (or with a newline) gets a scroll box instead of an inline value. */
export const LONG_TEXT_LENGTH = 160

export type ReadableEntry =
  | { type: 'text'; label: string | null; text: string; long: boolean }
  | { type: 'boolean'; label: string | null; value: boolean }
  | { type: 'empty'; label: string | null }
  | { type: 'group'; label: string | null; items: ReadableEntry[] }
  | { type: 'more'; count: number }

export type ParsedPayload = { kind: 'empty' } | { kind: 'json'; value: unknown } | { kind: 'text'; text: string }

/** Parses the raw string the IPC layer carries; anything that is not JSON is kept as text so it still shows. */
export function parsePayload(raw: string | null): ParsedPayload {
  if (raw === null || raw.trim().length === 0) return { kind: 'empty' }
  try {
    return { kind: 'json', value: JSON.parse(raw) }
  } catch {
    return { kind: 'text', text: raw }
  }
}

/** Pretty-prints JSON for the JSON view; non-JSON text comes back untouched. */
export function formatJson(raw: string | null): string {
  const parsed = parsePayload(raw)
  if (parsed.kind === 'empty') return ''
  if (parsed.kind === 'text') return parsed.text
  return JSON.stringify(parsed.value, null, 2)
}

const ACRONYMS = new Set(['url', 'id', 'ats', 'pdf', 'html', 'json', 'api', 'mcp', 'usd'])

/** `matchScore` / `match_score` / `linkedinUrl` become "Match score" / "Match score" / "Linkedin URL". */
export function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_\-.]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase())
  if (words.length === 0) return key
  return words
    .map((word, index) => {
      if (ACRONYMS.has(word)) return word.toUpperCase()
      return index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word
    })
    .join(' ')
}

function isPrimitive(value: unknown): value is string | number | boolean | null | undefined {
  return value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function textEntry(label: string | null, text: string): ReadableEntry {
  return { type: 'text', label, text, long: text.length >= LONG_TEXT_LENGTH || text.includes('\n') }
}

function primitiveEntry(label: string | null, value: string | number | boolean | null | undefined): ReadableEntry {
  if (value === null || value === undefined) return { type: 'empty', label }
  if (typeof value === 'boolean') return { type: 'boolean', label, value }
  if (typeof value === 'number') return textEntry(label, Number.isFinite(value) ? String(value) : 'NaN')
  return value.length === 0 ? { type: 'empty', label } : textEntry(label, value)
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * Builds the row tree for one value. A short array of primitives is one
 * comma-joined row (`Sources: greenhouse, lever`) rather than a list of
 * one-word rows; anything else nests as a group.
 */
export function toReadable(value: unknown, label: string | null = null, depth = 0): ReadableEntry {
  if (isPrimitive(value)) return primitiveEntry(label, value)
  if (depth >= MAX_DEPTH) return textEntry(label, safeStringify(value))

  if (Array.isArray(value)) {
    if (value.length === 0) return { type: 'empty', label }
    const allShortPrimitives = value.every((item) => isPrimitive(item) && !(typeof item === 'string' && (item.length >= LONG_TEXT_LENGTH || item.includes('\n'))))
    if (allShortPrimitives) {
      const parts = value.slice(0, MAX_LIST_ITEMS).map((item) => (item === null || item === undefined ? '' : String(item))).filter((part) => part.length > 0)
      const text = parts.join(', ')
      if (value.length > MAX_LIST_ITEMS) {
        return { type: 'group', label, items: [textEntry(null, text), { type: 'more', count: value.length - MAX_LIST_ITEMS }] }
      }
      return text.length === 0 ? { type: 'empty', label } : textEntry(label, text)
    }
    const items = value.slice(0, MAX_LIST_ITEMS).map((item, index) => toReadable(item, String(index + 1), depth + 1))
    if (value.length > MAX_LIST_ITEMS) items.push({ type: 'more', count: value.length - MAX_LIST_ITEMS })
    return { type: 'group', label, items }
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return { type: 'empty', label }
    const items = entries.slice(0, MAX_LIST_ITEMS).map(([key, item]) => toReadable(item, humanizeKey(key), depth + 1))
    if (entries.length > MAX_LIST_ITEMS) items.push({ type: 'more', count: entries.length - MAX_LIST_ITEMS })
    return { type: 'group', label, items }
  }

  // Functions, symbols, bigints: not something JSON.parse produces, but the
  // renderer must not throw on them either.
  return textEntry(label, safeStringify(value))
}

/** The rows to show for a raw payload: `null` when there is nothing to show at all. */
export function readablePayload(raw: string | null): ReadableEntry[] | null {
  const parsed = parsePayload(raw)
  if (parsed.kind === 'empty') return null
  if (parsed.kind === 'text') return [textEntry(null, parsed.text)]
  const root = toReadable(parsed.value)
  return root.type === 'group' && root.label === null ? root.items : [root]
}

export function isPayloadView(value: unknown): value is PayloadView {
  return value === 'readable' || value === 'json'
}

/** The last view the user picked, used as the default for rows opened afterwards. Storage failures fall back to readable. */
export function readPayloadViewPreference(storage: Pick<Storage, 'getItem'> | null = safeStorage()): PayloadView {
  try {
    const stored = storage?.getItem(PREFERENCE_KEY)
    return isPayloadView(stored) ? stored : 'readable'
  } catch {
    return 'readable'
  }
}

export function writePayloadViewPreference(view: PayloadView, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(PREFERENCE_KEY, view)
  } catch {
    // A full or blocked localStorage only loses the remembered default, never the view itself.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

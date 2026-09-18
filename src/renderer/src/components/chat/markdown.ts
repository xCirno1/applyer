/**
 * A small in-house markdown parser for chat messages - no dependency is
 * addable in this worktree, and a model's reply is untrusted text that has
 * to render safely without `dangerouslySetInnerHTML`. Not a CommonMark
 * implementation: it covers what a chat agent's replies actually use
 * (paragraphs, headings, lists with one level of nesting, fenced code,
 * inline emphasis/code/links, blockquotes, rules, and simple pipe tables)
 * and degrades anything else to plain text rather than throwing.
 *
 * Streaming-safe by construction: a fenced code block with no closing
 * fence simply collects every remaining line as code (see `parseBlocks`'s
 * fence branch), an unmatched `**`/`*`/`` ` ``/`[` is left as literal text
 * (see `parseInlineSegment`), and every parse here is a straight line/char
 * scan with no backtracking that could throw on a truncated mid-token
 * string - so calling this again after every delta while a message streams
 * never produces a broken render, only a plainer one until the closing
 * token arrives.
 *
 * A single line break inside a paragraph is always rendered as a break
 * (never collapsed to a space): the source is chat replies, not prose
 * copy-edited into single-blank-line paragraphs, so CommonMark's "soft
 * break renders as whitespace" rule would visually run unrelated lines
 * together.
 */

export type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'bold'; children: InlineNode[] }
  | { type: 'italic'; children: InlineNode[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: InlineNode[] }
  | { type: 'break' }

export interface ListItem {
  children: InlineNode[]
  /** Nested blocks under this item - typically a nested list, occasionally an extra paragraph. */
  nested: BlockNode[]
}

export type BlockNode =
  | { type: 'paragraph'; children: InlineNode[] }
  | { type: 'heading'; level: 1 | 2 | 3; children: InlineNode[] }
  | { type: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { type: 'code'; language: string | null; value: string }
  | { type: 'blockquote'; children: BlockNode[] }
  | { type: 'hr' }
  | { type: 'table'; header: InlineNode[][]; align: Array<'left' | 'center' | 'right' | null>; rows: InlineNode[][][] }

export function parseMarkdown(source: string): BlockNode[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  return parseBlocks(lines)
}

// ---------------------------------------------------------------------------
// Block level
// ---------------------------------------------------------------------------

/** `lines[i]`, but always a string - every helper below takes `string`, and an out-of-range index never actually reaches them (every loop is bounds-checked first). */
function at(lines: string[], i: number): string {
  return lines[i] ?? ''
}

function parseBlocks(lines: string[]): BlockNode[] {
  const blocks: BlockNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = at(lines, i)
    if (line.trim() === '') {
      i++
      continue
    }

    const fence = matchFenceOpen(line)
    if (fence) {
      i++
      const codeLines: string[] = []
      while (i < lines.length && !matchFenceClose(at(lines, i), fence.char, fence.length)) {
        codeLines.push(at(lines, i))
        i++
      }
      if (i < lines.length) i++ // consume the closing fence line, if there was one
      blocks.push({ type: 'code', language: fence.language, value: codeLines.join('\n') })
      continue
    }

    if (isHr(line)) {
      blocks.push({ type: 'hr' })
      i++
      continue
    }

    const heading = matchHeading(line)
    if (heading) {
      blocks.push({ type: 'heading', level: heading.level, children: parseInlineSegment(heading.text) })
      i++
      continue
    }

    if (isBlockquote(line)) {
      const quoteLines: string[] = []
      while (i < lines.length && isBlockquote(at(lines, i))) {
        quoteLines.push(stripBlockquoteMarker(at(lines, i)))
        i++
      }
      blocks.push({ type: 'blockquote', children: parseBlocks(quoteLines) })
      continue
    }

    if (isTableStart(lines, i)) {
      const table = parseTable(lines, i)
      blocks.push(table.block)
      i = table.next
      continue
    }

    const list = tryParseList(lines, i)
    if (list) {
      blocks.push(list.block)
      i = list.next
      continue
    }

    const paraLines: string[] = []
    while (
      i < lines.length &&
      at(lines, i).trim() !== '' &&
      !isHr(at(lines, i)) &&
      !matchHeading(at(lines, i)) &&
      !matchFenceOpen(at(lines, i)) &&
      !isBlockquote(at(lines, i)) &&
      !isTableStart(lines, i) &&
      !matchListMarker(at(lines, i))
    ) {
      paraLines.push(at(lines, i))
      i++
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'paragraph', children: parseInlineSegment(paraLines.join('\n')) })
    } else {
      // Every recognised branch above declined this line and the paragraph
      // scan (which only refuses on those same branches) also produced
      // nothing - this can only happen for a line matching `matchListMarker`
      // that `tryParseList` itself rejected (should not occur in practice,
      // since the two use the same predicate), but consume it as a literal
      // paragraph rather than looping forever.
      blocks.push({ type: 'paragraph', children: parseInlineSegment(line) })
      i++
    }
  }

  return blocks
}

function matchFenceOpen(line: string): { char: string; length: number; language: string | null } | null {
  const m = /^ {0,3}(`{3,}|~{3,})[ \t]*(\S*)/.exec(line)
  if (!m) return null
  const fence = m[1] ?? ''
  const language = m[2] ? m[2] : null
  return { char: fence[0] ?? '`', length: fence.length, language }
}

function matchFenceClose(line: string, char: string, minLength: number): boolean {
  const trimmed = line.trim()
  if (trimmed.length < minLength) return false
  for (const c of trimmed) if (c !== char) return false
  return true
}

function isHr(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed.length < 3) return false
  return /^([-*_])\1{2,}$/.test(trimmed) || /^([-*_])(\s*\1){2,}$/.test(trimmed)
}

function matchHeading(line: string): { level: 1 | 2 | 3; text: string } | null {
  const m = /^ {0,3}(#{1,6})(?:\s+(.*))?$/.exec(line)
  if (!m) return null
  const level = (m[1] ?? '').length
  if (level > 3) return null
  return { level: level as 1 | 2 | 3, text: (m[2] ?? '').trim() }
}

function isBlockquote(line: string): boolean {
  return /^ {0,3}>/.test(line)
}

function stripBlockquoteMarker(line: string): string {
  return line.replace(/^ {0,3}>[ \t]?/, '')
}

interface ListMarker {
  indent: number
  ordered: boolean
  number: number | null
  markerWidth: number
  content: string
}

function matchListMarker(line: string): ListMarker | null {
  const bullet = /^( {0,3})([-*+])([ \t]+)?(.*)$/.exec(line)
  if (bullet) {
    const spacing = bullet[3] ?? ''
    const rest = bullet[4] ?? ''
    if (spacing.length > 0 || rest === '') {
      const indent = (bullet[1] ?? '').length
      return { indent, ordered: false, number: null, markerWidth: indent + 1 + spacing.length, content: rest }
    }
  }
  const ordered = /^( {0,3})(\d{1,9})([.)])([ \t]+)?(.*)$/.exec(line)
  if (ordered) {
    const spacing = ordered[4] ?? ''
    const rest = ordered[5] ?? ''
    if (spacing.length > 0 || rest === '') {
      const indent = (ordered[1] ?? '').length
      const numberText = ordered[2] ?? '1'
      return {
        indent,
        ordered: true,
        number: Number(numberText),
        markerWidth: indent + numberText.length + 1 + spacing.length,
        content: rest
      }
    }
  }
  return null
}

function leadingSpaces(line: string): number {
  let n = 0
  while (n < line.length && line[n] === ' ') n++
  return n
}

function listItemFromBlocks(blocks: BlockNode[]): ListItem {
  if (blocks.length === 0) return { children: [], nested: [] }
  const [firstBlock, ...rest] = blocks
  if (firstBlock && firstBlock.type === 'paragraph') return { children: firstBlock.children, nested: rest }
  return { children: [], nested: blocks }
}

function tryParseList(lines: string[], start: number): { block: BlockNode; next: number } | null {
  const first = matchListMarker(lines[start] ?? '')
  if (!first) return null
  const { ordered, indent: baseIndent } = first
  const items: ListItem[] = []
  let i = start

  while (i < lines.length) {
    const marker = matchListMarker(lines[i] ?? '')
    if (!marker || marker.ordered !== ordered || marker.indent !== baseIndent) break
    const contentIndent = marker.indent + marker.markerWidth
    const itemLines = [marker.content]
    i++
    while (i < lines.length && (lines[i] ?? '').trim() !== '') {
      const line = lines[i] ?? ''
      const sibling = matchListMarker(line)
      if (sibling && sibling.indent === baseIndent) break
      const indent = leadingSpaces(line)
      if (indent < contentIndent) break
      itemLines.push(line.slice(contentIndent))
      i++
    }
    items.push(listItemFromBlocks(parseBlocks(itemLines)))
  }

  return items.length > 0 ? { block: { type: 'list', ordered, start: first.number ?? 1, items }, next: i } : null
}

function isTableRow(line: string): boolean {
  return line.trim() !== '' && line.includes('|')
}

function splitTableRow(line: string): string[] {
  let trimmed = line.trim()
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1)
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1)
  const cells: string[] = []
  let current = ''
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i]
    if (c === '\\' && trimmed[i + 1] === '|') {
      current += '|'
      i++
      continue
    }
    if (c === '|') {
      cells.push(current)
      current = ''
      continue
    }
    current += c
  }
  cells.push(current)
  return cells
}

function isTableSeparatorRow(line: string): boolean {
  if (!isTableRow(line)) return false
  const cells = splitTableRow(line)
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell.trim()))
}

function isTableStart(lines: string[], i: number): boolean {
  const header = lines[i]
  const separator = lines[i + 1]
  return header !== undefined && separator !== undefined && isTableRow(header) && isTableSeparatorRow(separator)
}

function tableAlign(cell: string): 'left' | 'center' | 'right' | null {
  const trimmed = cell.trim()
  const left = trimmed.startsWith(':')
  const right = trimmed.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  if (left) return 'left'
  return null
}

function parseTable(lines: string[], start: number): { block: BlockNode; next: number } {
  const header = splitTableRow(lines[start] ?? '').map((cell) => parseInlineSegment(cell.trim()))
  const align = splitTableRow(lines[start + 1] ?? '').map(tableAlign)
  const rows: InlineNode[][][] = []
  let i = start + 2
  while (i < lines.length && isTableRow(lines[i] ?? '') && !isTableSeparatorRow(lines[i] ?? '')) {
    rows.push(splitTableRow(lines[i] ?? '').map((cell) => parseInlineSegment(cell.trim())))
    i++
  }
  return { block: { type: 'table', header, align, rows }, next: i }
}

// ---------------------------------------------------------------------------
// Inline level
// ---------------------------------------------------------------------------

function parseInlineSegment(text: string): InlineNode[] {
  const nodes: InlineNode[] = []
  let buffer = ''
  let i = 0

  const flush = (): void => {
    if (buffer) {
      nodes.push({ type: 'text', value: buffer })
      buffer = ''
    }
  }

  while (i < text.length) {
    const ch = text[i]

    if (ch === '\n') {
      flush()
      nodes.push({ type: 'break' })
      i++
      continue
    }

    if (ch === '`') {
      const close = text.indexOf('`', i + 1)
      if (close !== -1) {
        flush()
        nodes.push({ type: 'code', value: text.slice(i + 1, close) })
        i = close + 1
        continue
      }
      buffer += ch
      i++
      continue
    }

    if (ch === '[') {
      const link = tryParseLink(text, i)
      if (link) {
        flush()
        nodes.push(link.node)
        i = link.next
        continue
      }
      buffer += ch
      i++
      continue
    }

    if ((ch === '*' || ch === '_') && text[i + 1] === ch) {
      const marker = ch + ch
      const close = text.indexOf(marker, i + 2)
      if (close !== -1 && close > i + 2) {
        flush()
        nodes.push({ type: 'bold', children: parseInlineSegment(text.slice(i + 2, close)) })
        i = close + 2
        continue
      }
      buffer += marker
      i += 2
      continue
    }

    if (ch === '*' || ch === '_') {
      const close = text.indexOf(ch, i + 1)
      if (close !== -1 && close > i + 1) {
        flush()
        nodes.push({ type: 'italic', children: parseInlineSegment(text.slice(i + 1, close)) })
        i = close + 1
        continue
      }
      buffer += ch
      i++
      continue
    }

    buffer += ch
    i++
  }

  flush()
  return nodes
}

/** Only exported for the inline-rendering side (`MarkdownView`) needing to parse table cells the same way; not for general use. */
export function parseInline(text: string): InlineNode[] {
  return parseInlineSegment(text)
}

function tryParseLink(text: string, start: number): { node: InlineNode; next: number } | null {
  const closeBracket = text.indexOf(']', start + 1)
  if (closeBracket === -1) return null
  if (text[closeBracket + 1] !== '(') return null
  const closeParen = text.indexOf(')', closeBracket + 2)
  if (closeParen === -1) return null
  const href = text.slice(closeBracket + 2, closeParen).trim()
  if (!/^https?:\/\//i.test(href)) return null
  const label = text.slice(start + 1, closeBracket)
  return { node: { type: 'link', href, children: parseInlineSegment(label) }, next: closeParen + 1 }
}

/**
 * A tolerant CSV reader for files this app did not write.
 *
 * `csv.ts` next door is the other direction — it renders our own tables and
 * so controls the shape it produces. This one is handed whatever a user
 * exported from a spreadsheet, a crawler, or another tool, so it follows
 * RFC 4180 for quoting and is deliberately forgiving everywhere the spec is
 * silent: a UTF-8 BOM, `\r\n`/`\n`/`\r` line endings mixed in one file, rows
 * that are shorter or longer than the header, and a trailing newline are all
 * ordinary rather than errors.
 *
 * The delimiter is sniffed rather than assumed: a "CSV" exported from a
 * spreadsheet in a locale that uses `,` as the decimal separator is
 * semicolon-delimited, and reading it as comma-delimited yields one column
 * per row with no visible clue as to why.
 */

export interface ParsedCsv {
  /** The first row of the file. Empty only when the file held no rows at all. */
  headers: string[]
  /** Every row after the header, capped at `maxRows`. */
  rows: string[][]
  /** True when the file had more data rows than `maxRows` and the tail was dropped. */
  truncated: boolean
  delimiter: string
}

const CANDIDATE_DELIMITERS = [',', ';', '\t', '|']

/**
 * Counts each candidate outside quoted fields on the header line and takes
 * the most frequent, falling back to a comma when nothing separates anything
 * (a single-column file). Only the first line is examined: it is the one row
 * guaranteed to be present, and a header rarely contains free text with
 * punctuation in it.
 */
export function sniffDelimiter(text: string): string {
  const counts = new Map<string, number>(CANDIDATE_DELIMITERS.map((d) => [d, 0]))
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') {
      // A doubled quote inside a quoted field is an escaped quote, not the end of one.
      if (inQuotes && text[i + 1] === '"') {
        i++
        continue
      }
      inQuotes = !inQuotes
      continue
    }
    if (inQuotes || char === undefined) continue
    if (char === '\n' || char === '\r') break
    const seen = counts.get(char)
    if (seen !== undefined) counts.set(char, seen + 1)
  }

  let best = ','
  let bestCount = 0
  for (const delimiter of CANDIDATE_DELIMITERS) {
    const count = counts.get(delimiter) ?? 0
    if (count > bestCount) {
      best = delimiter
      bestCount = count
    }
  }
  return best
}

function isBlankRow(row: string[]): boolean {
  return row.every((cell) => cell.trim() === '')
}

/**
 * `maxRows` bounds the data rows kept, not the bytes read: the caller has
 * already decided the file is small enough to hold in memory, and stopping
 * early here is about what we are willing to plan an import over.
 */
export function parseCsv(input: string, maxRows: number): ParsedCsv {
  // A BOM would otherwise become part of the first header's name, which
  // silently breaks matching that header by name.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const delimiter = sniffDelimiter(text)

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let truncated = false
  let stopped = false
  // The header row is kept out of the cap, so `maxRows` counts data rows.
  const rowLimit = maxRows + 1

  const endField = (): void => {
    row.push(field)
    field = ''
  }

  const endRow = (): boolean => {
    endField()
    // A trailing newline produces one empty field, which is not a row.
    if (!isBlankRow(row)) rows.push(row)
    row = []
    return rows.length < rowLimit
  }

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"' && field === '') {
      // Only a field that opens with a quote is a quoted field; a stray quote
      // mid-value (`5" monitor`) is data.
      inQuotes = true
      continue
    }

    if (char === delimiter) {
      endField()
      continue
    }

    if (char === '\r' || char === '\n') {
      // \r\n is one line ending, not two.
      if (char === '\r' && text[i + 1] === '\n') i++
      if (!endRow()) {
        // Only text that still holds a row counts as truncation: a file whose
        // last row lands exactly on the cap was read in full.
        truncated = text.slice(i + 1).trim() !== ''
        stopped = true
        break
      }
      continue
    }

    field += char
  }

  // Whatever is left when the text runs out is a final row without a newline.
  if (!stopped && (field !== '' || row.length > 0)) endRow()

  const headers = (rows[0] ?? []).map((cell) => cell.trim())
  return { headers, rows: rows.slice(1), truncated, delimiter }
}

/** Reads one column of a row, tolerating a row shorter than the header. */
export function cellAt(row: readonly string[], index: number | null): string {
  if (index === null || index < 0 || index >= row.length) return ''
  return (row[index] ?? '').trim()
}

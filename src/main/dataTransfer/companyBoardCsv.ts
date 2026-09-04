import { boardKeyOf, isPlausibleBoardToken, isValidBoardDescriptor, parseAnyBoardUrl } from '../browser/ats/providers'
import { cellAt } from './csvParse'
import { BOARD_CSV_PREVIEW_ROWS, MAX_COMPANY_BOARDS } from '@shared/constants'
import { isAtsProvider } from '@shared/types/companyBoard'
import type {
  AtsBoardDescriptor,
  AtsProvider,
  BoardCsvCapacity,
  BoardCsvField,
  BoardCsvImportOptions,
  BoardCsvMapping,
  BoardCsvPlan,
  BoardCsvPreviewRow
} from '@shared/types/companyBoard'

/**
 * Turning a CSV of ATS boards into a watchlist.
 *
 * All of it is plain functions over rows — no database, no filesystem, no
 * network — so the rules that decide what a file actually adds (which rows
 * are addressable, which are the same board twice, which ones fit under the
 * ceiling, and in what order they are taken) are testable on their own. The
 * IPC layer supplies the two things that come from outside: whether a board
 * is already tracked, and how much room is left.
 *
 * The ordering rule is the one worth stating. Postings per board are heavily
 * skewed — a published feed's top few hundred boards hold half the postings —
 * and `MAX_COMPANY_BOARDS` is far smaller than such a file, so an import is
 * always a choice of *which* boards to take. Taking them in file order would
 * make that choice arbitrary; taking them by open-posting count spends the
 * watchlist's capacity on the boards that can actually contribute results.
 */

/** Header names that map onto each field, normalised. First match wins. */
const HEADER_ALIASES: Record<BoardCsvField, string[]> = {
  company: ['company', 'companyname', 'name', 'employer', 'organization', 'organisation', 'org'],
  provider: ['provider', 'ats', 'atsprovider', 'platform', 'boardprovider', 'source', 'system'],
  token: ['token', 'slug', 'boardtoken', 'boardid', 'boardslug', 'companytoken', 'tenant', 'identifier'],
  openPostings: [
    'openpostings',
    'openroles',
    'openjobs',
    'postings',
    'jobcount',
    'jobs',
    'numjobs',
    'opencount',
    'count',
    'roles'
  ],
  boardUrl: ['boardurl', 'url', 'boardlink', 'joburl', 'jobsurl', 'careersurl', 'link', 'board'],
  apiUrl: ['apiurl', 'api', 'apilink', 'apiendpoint', 'endpoint']
}

/**
 * Fields are matched in this order, and a header is claimed by the first
 * field that wants it. `boardUrl` before `apiUrl` matters on a feed that has
 * both, and `token` before `boardUrl` keeps a `board` column holding slugs
 * from being read as a URL column.
 */
const MATCH_ORDER: BoardCsvField[] = ['provider', 'token', 'openPostings', 'boardUrl', 'apiUrl', 'company']

function normaliseHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * A first guess at which column is which, from the header row.
 *
 * Only ever a starting point: the mapping the import runs on is whatever the
 * user confirms in the dialog, so a wrong guess here costs a dropdown change
 * rather than a wrong import.
 */
export function suggestBoardCsvMapping(headers: readonly string[]): BoardCsvMapping {
  const normalised = headers.map(normaliseHeader)
  const mapping: BoardCsvMapping = {
    company: null,
    provider: null,
    token: null,
    openPostings: null,
    boardUrl: null,
    apiUrl: null
  }
  const claimed = new Set<number>()

  for (const field of MATCH_ORDER) {
    for (const alias of HEADER_ALIASES[field]) {
      const index = normalised.findIndex((header, i) => !claimed.has(i) && header === alias)
      if (index !== -1) {
        mapping[field] = index
        claimed.add(index)
        break
      }
    }
  }

  return mapping
}

/**
 * Whether a mapping can address a board at all. Provider+token is one way, a
 * URL of either kind is the other; with neither, every row is unusable and
 * the import is refused up front rather than reported as "0 of 10,000".
 */
export function isMappingUsable(mapping: BoardCsvMapping): boolean {
  const hasPair = mapping.provider !== null && mapping.token !== null
  return hasPair || mapping.boardUrl !== null || mapping.apiUrl !== null
}

/** Drops anything a renderer payload could hold that isn't a column of this file. */
export function normaliseMapping(raw: unknown, columnCount: number): BoardCsvMapping {
  const source = (raw ?? {}) as Record<string, unknown>
  const mapping: BoardCsvMapping = {
    company: null,
    provider: null,
    token: null,
    openPostings: null,
    boardUrl: null,
    apiUrl: null
  }
  for (const field of MATCH_ORDER) {
    const value = source[field]
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < columnCount) {
      mapping[field] = value
    }
  }
  return mapping
}

/**
 * Provider names in the wild carry the host or the product name rather than
 * our identifier: `greenhouse.io`, `Lever.co`, `AshbyHQ`, `Workday`. Matching
 * on containment covers all of those without a per-feed alias list.
 */
export function normaliseProvider(value: string): AtsProvider | null {
  const text = value.trim().toLowerCase()
  if (!text) return null
  if (isAtsProvider(text)) return text
  if (text.includes('greenhouse')) return 'greenhouse'
  if (text.includes('lever')) return 'lever'
  if (text.includes('ashby')) return 'ashby'
  if (text.includes('workday')) return 'workday'
  return null
}

/** `"1,234"`, `"12 "`, `"7.0"` are all counts; `""`, `"n/a"` and `"-3"` are not. */
export function parseOpenPostings(value: string): number | null {
  const text = value.replace(/[\s,_]/g, '')
  if (!text) return null
  const parsed = Number(text)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.floor(parsed)
}

export interface CsvBoardCandidate {
  descriptor: AtsBoardDescriptor
  boardKey: string
  companyName: string
  /** Null when the file carries no count for this row — not the same as zero. */
  openPostings: number | null
}

/**
 * One row of the file as a board, or null when it doesn't describe one.
 *
 * The provider/token pair is preferred over the URLs because it is what the
 * user mapped explicitly, with one exception: Workday needs a host and a
 * career-site id that a bare tenant can't supply, so a Workday row is only
 * addressable through one of its URLs.
 */
export function resolveCsvRow(row: readonly string[], mapping: BoardCsvMapping): CsvBoardCandidate | null {
  const provider = normaliseProvider(cellAt(row, mapping.provider))
  const token = cellAt(row, mapping.token)

  let descriptor: AtsBoardDescriptor | null =
    provider && provider !== 'workday' && isPlausibleBoardToken(token)
      ? { provider, token, host: null, site: null }
      : null

  if (!descriptor) {
    // A URL that parses to a different provider than the row claims is
    // trusted over the claim: the URL names a host, the column is a label.
    descriptor = parseAnyBoardUrl(cellAt(row, mapping.boardUrl)) ?? parseAnyBoardUrl(cellAt(row, mapping.apiUrl))
  }

  // The same gate an imported bundle passes through: a row that cannot
  // address a real board (a Workday tenant with no career site, a host that
  // isn't the provider's) is not a board, whichever file it came from.
  if (!descriptor || !isValidBoardDescriptor(descriptor)) return null

  const companyName = cellAt(row, mapping.company) || descriptor.token

  return {
    descriptor,
    boardKey: boardKeyOf(descriptor),
    companyName: companyName.slice(0, 200),
    openPostings: parseOpenPostings(cellAt(row, mapping.openPostings))
  }
}

export interface PlanCsvImportInput {
  rows: readonly (readonly string[])[]
  mapping: BoardCsvMapping
  options: BoardCsvImportOptions
  /** Whether the watchlist already holds this board. */
  isTracked: (boardKey: string) => boolean
  capacity: BoardCsvCapacity
}

export interface PlannedCsvImport {
  plan: BoardCsvPlan
  /** The boards to insert, in the order they'd be added. */
  boards: CsvBoardCandidate[]
}

function toPreviewRow(candidate: CsvBoardCandidate): BoardCsvPreviewRow {
  return {
    companyName: candidate.companyName,
    provider: candidate.descriptor.provider,
    token: candidate.descriptor.token,
    site: candidate.descriptor.site,
    openPostings: candidate.openPostings
  }
}

/**
 * What a mapping would add, and why every other row wouldn't be.
 *
 * Each row lands in exactly one bucket and the buckets sum to `totalRows`, so
 * the dialog can account for a file in full rather than reporting a number
 * the user has to take on trust.
 */
export function planCsvImport({ rows, mapping, options, isTracked, capacity }: PlanCsvImportInput): PlannedCsvImport {
  const totalRows = rows.length
  let unusable = 0
  let belowThreshold = 0
  let duplicates = 0
  let alreadyTracked = 0

  // Only meaningful when the file actually carries counts; without that
  // column every row's count is unknown and a floor would reject all of them.
  const threshold = mapping.openPostings !== null ? Math.max(0, options.minOpenPostings) : 0

  const candidates: CsvBoardCandidate[] = []
  for (const row of rows) {
    const candidate = resolveCsvRow(row, mapping)
    if (!candidate) {
      unusable++
      continue
    }
    if (threshold > 0 && (candidate.openPostings ?? 0) < threshold) {
      belowThreshold++
      continue
    }
    candidates.push(candidate)
  }

  // Most postings first, so a file larger than the watchlist's capacity is
  // truncated at the boards that contribute least. `sort` is stable, so rows
  // with equal counts (including the unknown ones, which sort last) keep
  // their file order.
  const ranked = [...candidates].sort((a, b) => (b.openPostings ?? -1) - (a.openPostings ?? -1))

  const seen = new Set<string>()
  const accepted: CsvBoardCandidate[] = []
  let overLimit = 0
  const room = Math.max(0, Math.min(options.maxImport, capacity.remaining))

  for (const candidate of ranked) {
    if (seen.has(candidate.boardKey)) {
      duplicates++
      continue
    }
    seen.add(candidate.boardKey)

    if (isTracked(candidate.boardKey)) {
      alreadyTracked++
      continue
    }
    if (accepted.length >= room) {
      overLimit++
      continue
    }
    accepted.push(candidate)
  }

  return {
    plan: {
      totalRows,
      unusable,
      belowThreshold,
      duplicates,
      alreadyTracked,
      overLimit,
      willImport: accepted.length,
      sample: accepted.slice(0, BOARD_CSV_PREVIEW_ROWS).map(toPreviewRow),
      capacity
    },
    boards: accepted
  }
}

/** Clamps the renderer's numbers, which are typed into free-text fields. */
export function normaliseImportOptions(raw: unknown, remaining: number): BoardCsvImportOptions {
  const source = (raw ?? {}) as Record<string, unknown>
  const min = Number(source.minOpenPostings)
  const max = Number(source.maxImport)
  return {
    minOpenPostings: Number.isFinite(min) && min > 0 ? Math.floor(min) : 0,
    maxImport:
      Number.isFinite(max) && max > 0
        ? Math.min(Math.floor(max), MAX_COMPANY_BOARDS)
        : Math.max(0, Math.min(remaining, MAX_COMPANY_BOARDS))
  }
}

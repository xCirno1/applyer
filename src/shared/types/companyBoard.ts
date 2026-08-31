/**
 * A company's own ATS job board, tracked as a search source.
 *
 * None of these providers has a cross-company search endpoint — every call is
 * scoped to one company's board — so "searching Greenhouse" means fetching the
 * boards of companies we've been told about and filtering locally. This type
 * is what identifies one such board.
 */
export type AtsProvider = 'greenhouse' | 'lever' | 'ashby' | 'workday'

export const ATS_PROVIDERS: AtsProvider[] = ['greenhouse', 'lever', 'ashby', 'workday']

export function isAtsProvider(value: unknown): value is AtsProvider {
  return typeof value === 'string' && (ATS_PROVIDERS as string[]).includes(value)
}

/**
 * Everything needed to address one board.
 *
 * Greenhouse/Lever/Ashby are a single slug on a fixed host. Workday is not:
 * its list endpoint is `POST https://{host}/wday/cxs/{tenant}/{site}/jobs`, so
 * it needs the data-centre host and the career-site id alongside the tenant
 * (which is what `token` holds for it). Those two are null for the other three.
 */
export interface AtsBoardDescriptor {
  provider: AtsProvider
  /** Board slug — for Workday, the tenant. */
  token: string
  /** Workday only: `acme.wd5.myworkdayjobs.com`. */
  host: string | null
  /** Workday only: the career-site id, e.g. `AcmeExternalCareerSite`. Case-sensitive. */
  site: string | null
}

export interface CompanyBoardRecord extends AtsBoardDescriptor {
  id: string
  /** Stable identity of the board: `provider:token[:host:site]`, lowercased. */
  boardKey: string
  /** What to show and to file postings under; falls back to the token. */
  companyName: string
  addedBy: 'user' | 'agent'
  enabled: boolean
  /** Last time a search actually fetched this board (null until the first one). */
  lastCheckedAt: string | null
  /** Postings returned by that fetch — 0 is a real answer (a live board with nothing open). */
  lastJobCount: number | null
  /** Untranslated diagnostic from the last failed fetch, or null if it succeeded. */
  lastError: string | null
  createdAt: string
}

export interface ListCompanyBoardsQuery {
  limit?: number
  offset?: number
  search?: string
}

export interface ListCompanyBoardsResult {
  boards: CompanyBoardRecord[]
  total: number
}

/** One (provider, slug) pair that answered during resolution, with what it returned. */
export interface BoardProbeCandidate {
  provider: AtsProvider
  token: string
  /** Postings on that board. 0 means the slug exists but nothing is open — not that the slug is wrong. */
  jobCount: number
}

export type ResolveBoardOutcome =
  | {
      status: 'resolved'
      descriptor: AtsBoardDescriptor
      companyName: string
      jobCount: number
      /**
       * False when the board was taken from an explicit URL/token that we
       * could not reach to confirm (offline, provider outage) — the caller
       * decides whether to store it anyway.
       */
      verified: boolean
      /** More than one provider answered with postings — an ATS migration can leave both boards live. */
      ambiguous: boolean
      candidates: BoardProbeCandidate[]
    }
  | { status: 'not_found'; triedTokens: string[] }
  | { status: 'error'; message: string }

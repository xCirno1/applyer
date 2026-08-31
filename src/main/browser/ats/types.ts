import type { AtsBoardDescriptor, AtsProvider } from '@shared/types/companyBoard'

/** One posting, normalised to the same shape whichever board it came from. */
export interface AtsPosting {
  /** The provider's own posting id — unique within (provider, token). */
  id: string
  title: string
  company: string
  location?: string
  department?: string
  team?: string
  employmentType?: string
  isRemote?: boolean
  /** Public posting URL, routable by `detectSource` / `get_job_details`. */
  url: string
  /** ISO timestamp, only when the board actually publishes one. */
  postedAt?: string
  /**
   * Whatever the board declares, carried across verbatim with its own period
   * label. Never rescaled: the label is typed by the employer and is
   * sometimes wrong, and a wrong label stays a wrong label while a rescale
   * turns it into a wrong number.
   */
  salaryRange?: string
  snippet: string
}

/**
 * `not_found` and an empty `ok` are different answers and must not be
 * collapsed: on all three slug providers a 404 means the slug is wrong, while
 * a 200 with no rows is a real board with nothing open right now.
 */
export type AtsBoardFetchOutcome =
  | { status: 'ok'; postings: AtsPosting[]; skipped: number }
  | { status: 'not_found' }
  | { status: 'error'; message: string }

export interface FetchBoardOptions {
  /**
   * The user's keyword query. Boards that can filter server-side (Workday)
   * use it; the ones that only serve a whole board ignore it and are
   * filtered locally instead.
   */
  query: string
  /** Upper bound on postings worth fetching — only meaningful for a paged provider. */
  limit: number
  /**
   * What to file these postings under. Lever, Ashby and Workday never name
   * the company in their payloads (the response assumes you know whose board
   * you asked for), so without this every posting from them would be labelled
   * with a slug.
   */
  companyName: string
  /**
   * Per-request timeout. Probing (many speculative requests behind a user
   * waiting on a dialog) uses a shorter one than a search does.
   */
  timeoutMs?: number
}

export interface AtsProviderAdapter {
  provider: AtsProvider
  /** Human label for warnings and logs. */
  label: string
  /**
   * True when `fetchBoard` sends the query to the provider instead of
   * returning the whole board, which makes the response query-dependent and
   * so part of its cache key.
   */
  serverSideQuery: boolean
  /**
   * False for providers that can't be found from a bare company name
   * (Workday needs a host, a tenant and a site, none of which are guessable).
   */
  probeable: boolean
  fetchBoard(descriptor: AtsBoardDescriptor, options: FetchBoardOptions): Promise<AtsBoardFetchOutcome>
  /** Parses one of this provider's board/posting URLs into a descriptor, or null if it isn't one. */
  parseBoardUrl(url: URL): AtsBoardDescriptor | null
}

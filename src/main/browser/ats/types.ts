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
  | {
      status: 'ok'
      postings: AtsPosting[]
      skipped: number
      /**
       * How many postings the board holds, when the provider says so and that
       * is more than were fetched. Only Workday pages server-side, so only it
       * can return fewer rows than the board has; without this the board's
       * open-role count would report the page cap (20/40/60) as the size of a
       * board with hundreds of roles. Absent means `postings.length` is the
       * whole answer.
       */
      total?: number
    }
  | { status: 'not_found' }
  | { status: 'error'; message: string }

export interface FetchBoardOptions {
  /**
   * The user's keyword query. Boards that can filter server-side (Workday)
   * use it; the ones that only serve a whole board ignore it and are
   * filtered locally instead.
   */
  query: string
  /**
   * How many postings to *fetch* — only meaningful for a paged provider
   * (Workday); the other three serve a whole board in one response and
   * ignore it. It is not the number of results the caller will show: the
   * location filter and the cross-board dedupe both run after this, so a
   * caller that ends up displaying N rows asks for more than N here.
   */
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

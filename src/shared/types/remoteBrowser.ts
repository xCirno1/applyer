/**
 * Attaching to a browser the user already has running, over Chrome's remote
 * debugging port, instead of launching a separate one.
 *
 * Applyer's default is to launch its own browser window with a fresh,
 * isolated profile. That window is signed in to nothing, so every job site
 * that needs an account wants a login first. Attaching to the user's everyday
 * Chrome (started with `--remote-debugging-port=9222`, or with "Allow remote
 * debugging" turned on) drives the browser they are already signed in to:
 * no profile copying, no cookie decryption, nothing that touches the profile
 * directory at all.
 *
 * The trade-off is scope, not code. Once that port is open it grants any
 * local process, not just Applyer, full control of every account signed in
 * to that browser. Applyer's own tools stay narrow (inspect/fill/click named
 * fields, no free navigation), but that is discipline in this codebase, not
 * a boundary the browser enforces. The settings UI says so before letting
 * the user turn it on.
 *
 * Only the interactive application window attaches. Read-only job searching
 * still runs in Applyer's own headless browser, since running scrapers in
 * the user's visible tabs would both clutter their session and tie the
 * scraping traffic to their real account.
 */
export interface RemoteBrowserSettings {
  enabled: boolean
  /** Chrome DevTools Protocol endpoint: an `http(s)://host:port` root or a `ws(s)://.../devtools/browser/<id>` URL. */
  endpoint: string
}

/** What Settings > Browser's "Test connection" reports back after attaching and disconnecting again. */
export interface RemoteBrowserProbe {
  /** e.g. "Chrome/131.0.6778.85", as the browser reports it over CDP. */
  browserVersion: string
  /** False for a browser with no default profile to drive, which a real session would refuse to attach to. */
  hasDefaultContext: boolean
  /** Open tabs in that default profile, so the user can tell it found the browser they meant. */
  pageCount: number
  /** The profile folder whose `DevToolsActivePort` file supplied the websocket path, or null when the address connected as typed. */
  profileDir: string | null
}

/** Chrome's conventional remote-debugging port on the loopback interface. */
export const DEFAULT_REMOTE_BROWSER_ENDPOINT = 'http://127.0.0.1:9222'

export const DEFAULT_REMOTE_BROWSER_SETTINGS: RemoteBrowserSettings = {
  enabled: false,
  endpoint: DEFAULT_REMOTE_BROWSER_ENDPOINT
}

/** Generous for a URL, tight enough that a persisted setting can't be used to store arbitrary blobs. */
export const REMOTE_BROWSER_ENDPOINT_MAX_LENGTH = 2048

/**
 * Playwright's `connectOverCDP` accepts either the debugging server's HTTP root
 * (it fetches `/json/version` itself) or the browser-level websocket that root
 * advertises, so those are the four schemes with any meaning here.
 */
const CDP_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'ws:', 'wss:'])

export type RemoteBrowserEndpointProblem = 'empty' | 'tooLong' | 'invalidUrl' | 'unsupportedProtocol'

export type RemoteBrowserEndpointCheck =
  | { ok: true; endpoint: string }
  | { ok: false; problem: RemoteBrowserEndpointProblem }

/**
 * Validates an endpoint the way both the settings form (for inline feedback)
 * and the IPC handler (for what actually gets stored) need to agree on.
 * Returns the trimmed string rather than `URL#href`, so what the user typed
 * is what they see back in the field, without a surprise trailing slash.
 */
export function checkRemoteBrowserEndpoint(value: unknown): RemoteBrowserEndpointCheck {
  if (typeof value !== 'string') return { ok: false, problem: 'invalidUrl' }
  const endpoint = value.trim()
  if (endpoint.length === 0) return { ok: false, problem: 'empty' }
  if (endpoint.length > REMOTE_BROWSER_ENDPOINT_MAX_LENGTH) return { ok: false, problem: 'tooLong' }
  let parsed: URL
  try {
    parsed = new URL(endpoint)
  } catch {
    return { ok: false, problem: 'invalidUrl' }
  }
  if (!CDP_PROTOCOLS.has(parsed.protocol)) return { ok: false, problem: 'unsupportedProtocol' }
  if (parsed.hostname.length === 0) return { ok: false, problem: 'invalidUrl' }
  return { ok: true, endpoint }
}

/** Runtime guard for a persisted or IPC-supplied value; the endpoint must pass `checkRemoteBrowserEndpoint`. */
export function isRemoteBrowserSettings(value: unknown): value is RemoteBrowserSettings {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RemoteBrowserSettings>
  return typeof candidate.enabled === 'boolean' && checkRemoteBrowserEndpoint(candidate.endpoint).ok
}

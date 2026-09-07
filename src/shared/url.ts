/**
 * Which URLs this app is willing to navigate to or hand to the OS.
 *
 * "Is it a valid URL" is the wrong question. `new URL()` — and therefore
 * zod's `.url()`, which is built on it — accepts `file:///etc/passwd`,
 * `data:text/html,...` and `javascript:...` as perfectly well-formed, so a
 * shape check alone lets every one of those through.
 *
 * It matters because job URLs reach the app from two places that are not the
 * user: the agent, via `queue_job`/`get_job_details`/`exclude_job`, and
 * third-party ATS feeds, whose `applyUrl`/`hostedUrl` fields are copied
 * straight into a job row (see `scrapers/ashby.ts` and `scrapers/lever.ts`).
 * Both end up somewhere that acts on the string: `page.goto()` in a real
 * browser context, or `shell.openExternal()`, which hands it to the OS to
 * resolve however it likes. A `file:` URL through the first one is an
 * arbitrary local file read whose contents come back to the caller; through
 * the second it is whatever the desktop does with that path.
 *
 * So the question worth asking is which schemes a job posting could possibly
 * live under, and the answer is the two the web uses.
 */
const NAVIGABLE_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:'])

/**
 * True only for an absolute `http:`/`https:` URL. Anything else — another
 * scheme, a relative path, a non-string, unparseable junk — is false, so
 * callers get one answer to check rather than a parse to repeat.
 *
 * Surrounding whitespace is tolerated because the callers that validate
 * agent input already trim, and a trailing newline is not what makes a URL
 * unsafe.
 */
export function isNavigableUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false
  try {
    return NAVIGABLE_PROTOCOLS.has(new URL(value.trim()).protocol)
  } catch {
    return false
  }
}

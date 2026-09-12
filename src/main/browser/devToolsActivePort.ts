import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Turning the remote-debugging address the user typed into something Playwright
 * can actually connect to.
 *
 * Playwright's `connectOverCDP` takes either the browser websocket URL or an
 * HTTP root it can discover that URL from, by fetching `/json/version`. A
 * Chrome started with `--remote-debugging-port` serves that. The switch Chrome
 * 144+ added under chrome://inspect/#remote-debugging does not: it answers 404
 * to every `/json/*` request and only accepts the websocket path, which is
 * written (with the port) to a `DevToolsActivePort` file in the profile folder
 * and changes on every launch, so it cannot be typed in once and kept.
 *
 * So an `http(s)://` loopback address is treated as "the browser listening on
 * this port", and the websocket path is looked up in the `DevToolsActivePort`
 * files of the Chromium-family profile folders this platform is known to use.
 * The HTTP root stays as the last candidate so the older flag-based setup
 * keeps working without a file lookup, and a `ws(s)://` address is passed
 * through untouched for anyone with a profile folder we don't know about.
 */

export interface DevToolsActivePortEntry {
  /** The profile folder the file was found in, for logs and the settings test result. */
  profileDir: string
  port: number
  /** Always `/devtools/browser/<id>`, as Chrome writes it. */
  path: string
}

const ACTIVE_PORT_FILENAME = 'DevToolsActivePort'

/** The user-data folders Chrome, Chromium, Edge, Brave and Vivaldi create by default, per platform. */
export function defaultChromiumProfileDirs(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): string[] {
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA || join(home, 'AppData', 'Local')
    return [
      'Google/Chrome/User Data',
      'Google/Chrome Beta/User Data',
      'Google/Chrome Dev/User Data',
      'Google/Chrome SxS/User Data',
      'Chromium/User Data',
      'Microsoft/Edge/User Data',
      'Microsoft/Edge Beta/User Data',
      'Microsoft/Edge Dev/User Data',
      'Microsoft/Edge SxS/User Data',
      'BraveSoftware/Brave-Browser/User Data',
      'Vivaldi/User Data'
    ].map((rel) => join(base, ...rel.split('/')))
  }
  if (platform === 'darwin') {
    const base = join(home, 'Library', 'Application Support')
    return [
      'Google/Chrome',
      'Google/Chrome Beta',
      'Google/Chrome Dev',
      'Google/Chrome Canary',
      'Chromium',
      'Microsoft Edge',
      'Microsoft Edge Beta',
      'Microsoft Edge Dev',
      'Microsoft Edge Canary',
      'BraveSoftware/Brave-Browser',
      'Vivaldi'
    ].map((rel) => join(base, ...rel.split('/')))
  }
  const base = env.XDG_CONFIG_HOME || join(home, '.config')
  return [
    ...[
      'google-chrome',
      'google-chrome-beta',
      'google-chrome-unstable',
      'chromium',
      'microsoft-edge',
      'microsoft-edge-beta',
      'microsoft-edge-dev',
      'BraveSoftware/Brave-Browser',
      'vivaldi'
    ].map((rel) => join(base, ...rel.split('/'))),
    // Sandboxed installs keep their config under their own roots, not XDG_CONFIG_HOME.
    join(home, 'snap', 'chromium', 'common', 'chromium'),
    join(home, '.var', 'app', 'com.google.Chrome', 'config', 'google-chrome'),
    join(home, '.var', 'app', 'org.chromium.Chromium', 'config', 'chromium'),
    join(home, '.var', 'app', 'com.microsoft.Edge', 'config', 'microsoft-edge'),
    join(home, '.var', 'app', 'com.brave.Browser', 'config', 'BraveSoftware', 'Brave-Browser')
  ]
}

/**
 * Chrome writes two lines: the port, then the browser websocket path. Anything
 * else (an empty file mid-write, a truncated one after a crash) is treated as
 * no file at all rather than as a port to try.
 */
export function parseDevToolsActivePort(content: string): { port: number; path: string } | null {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const [portLine, path] = lines
  if (lines.length !== 2 || portLine === undefined || path === undefined) return null
  if (!/^\d{1,5}$/.test(portLine)) return null
  const port = Number.parseInt(portLine, 10)
  if (port < 1 || port > 65535) return null
  if (!/^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(path)) return null
  return { port, path }
}

/** Reads every `DevToolsActivePort` under the given profile folders; folders without one (or with an unreadable/malformed one) are skipped. */
export async function findDevToolsActivePorts(
  profileDirs: readonly string[],
  read: (path: string) => Promise<string> = (path) => readFile(path, 'utf8')
): Promise<DevToolsActivePortEntry[]> {
  const entries = await Promise.all(
    profileDirs.map(async (profileDir): Promise<DevToolsActivePortEntry | null> => {
      let content: string
      try {
        content = await read(join(profileDir, ACTIVE_PORT_FILENAME))
      } catch {
        return null
      }
      const parsed = parseDevToolsActivePort(content)
      return parsed ? { profileDir, ...parsed } : null
    })
  )
  return entries.filter((entry): entry is DevToolsActivePortEntry => entry !== null)
}

function isLoopbackHostname(hostname: string): boolean {
  const bare = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return bare === 'localhost' || bare === '::1' || /^127(?:\.\d{1,3}){3}$/.test(bare)
}

export interface RemoteBrowserCandidate {
  url: string
  /** Set when the URL came from a `DevToolsActivePort` file rather than from the setting itself. */
  profileDir?: string
}

/**
 * The connection URLs to try, in order. A websocket address is the only
 * candidate. An HTTP loopback address yields one websocket candidate per
 * profile folder whose `DevToolsActivePort` names that port, followed by the
 * HTTP address itself; a non-loopback HTTP address is only itself, since a
 * file on this machine says nothing about a browser on another one.
 */
export async function resolveRemoteBrowserCandidates(
  endpoint: string,
  options: {
    profileDirs?: readonly string[]
    read?: (path: string) => Promise<string>
  } = {}
): Promise<RemoteBrowserCandidate[]> {
  const parsed = new URL(endpoint)
  if (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') return [{ url: endpoint }]
  if (!isLoopbackHostname(parsed.hostname)) return [{ url: endpoint }]

  const port = parsed.port ? Number.parseInt(parsed.port, 10) : parsed.protocol === 'https:' ? 443 : 80
  const entries = await findDevToolsActivePorts(options.profileDirs ?? defaultChromiumProfileDirs(), options.read)
  const seen = new Set<string>()
  const candidates: RemoteBrowserCandidate[] = []
  for (const entry of entries) {
    if (entry.port !== port) continue
    const url = `ws://${parsed.hostname}:${port}${entry.path}`
    if (seen.has(url)) continue
    seen.add(url)
    candidates.push({ url, profileDir: entry.profileDir })
  }
  candidates.push({ url: endpoint })
  return candidates
}

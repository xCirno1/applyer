import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { BrowserContext } from 'playwright'
import { appLogger } from '../logger'

type LookupAddress = { address: string; family: number }
type LookupAll = (hostname: string) => Promise<readonly LookupAddress[]>

export const LOCAL_ADDRESS_BLOCKED_MESSAGE =
  'Local and private network addresses are blocked. Enable “Allow Local Addresses” in Settings > Browser only for sites you trust.'

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a = 0, b = 0, c = 0] = octets
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  )
}

function expandIpv6(address: string): number[] | null {
  const withoutZone = (address.split('%', 1)[0] ?? address).toLowerCase()
  let source = withoutZone
  const dottedMatch = source.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)
  if (dottedMatch) {
    const ipv4 = dottedMatch[1]!
    if (isIP(ipv4) !== 4) return null
    const [a = 0, b = 0, c = 0, d = 0] = ipv4.split('.').map(Number)
    source = `${source.slice(0, -ipv4.length)}${((a << 8) | b).toString(16)}:${(
      (c << 8) |
      d
    ).toString(16)}`
  }

  const halves = source.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves[1] ? halves[1].split(':') : []
  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null
  const groups = [...left, ...Array.from({ length: missing }, () => '0'), ...right]
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null
  return groups.map((group) => Number.parseInt(group, 16))
}

/** True for addresses that must not be reachable unless the developer permission is enabled. */
export function isLocalOrPrivateAddress(address: string): boolean {
  const family = isIP(address.split('%', 1)[0] ?? address)
  if (family === 4) return isPrivateIpv4(address)
  if (family !== 6) return true

  const groups = expandIpv6(address)
  if (!groups) return true
  const [first = 0, second = 0, third = 0, fourth = 0, fifth = 0, sixth = 0, seventh = 0, eighth = 0] = groups

  // IPv4-mapped IPv6 must inherit the embedded IPv4 address's classification.
  if (first === 0 && second === 0 && third === 0 && fourth === 0 && fifth === 0 && sixth === 0xffff) {
    return isPrivateIpv4(`${seventh >> 8}.${seventh & 0xff}.${eighth >> 8}.${eighth & 0xff}`)
  }

  return (
    groups.every((group) => group === 0) || // unspecified
    (groups.slice(0, 7).every((group) => group === 0) && eighth === 1) || // loopback
    (first & 0xfe00) === 0xfc00 || // unique-local fc00::/7
    (first & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (first & 0xffc0) === 0xfec0 || // deprecated site-local fec0::/10
    (first & 0xff00) === 0xff00 || // multicast
    (first === 0x2001 && second === 0x0db8) || // documentation
    (first === 0x0100 && second === 0 && third === 0 && fourth === 0) // discard-only 100::/64
  )
}

const defaultLookup: LookupAll = async (hostname) => lookup(hostname, { all: true, verbatim: true })

/** Resolves hostnames and rejects if any answer can reach a non-public network. */
export async function assertRemoteNetworkUrl(url: string, lookupAll: LookupAll = defaultLookup): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('The destination is not a valid URL.')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http:// and https:// destinations are allowed.')
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) throw new Error(LOCAL_ADDRESS_BLOCKED_MESSAGE)

  const literalFamily = isIP(hostname)
  if (literalFamily) {
    if (isLocalOrPrivateAddress(hostname)) throw new Error(LOCAL_ADDRESS_BLOCKED_MESSAGE)
    return
  }

  let answers: readonly LookupAddress[]
  try {
    answers = await lookupAll(hostname)
  } catch {
    // Fail closed: letting Chromium resolve after our check failed would turn
    // a transient DNS error into a guard bypass.
    throw new Error('The destination hostname could not be safely resolved.')
  }
  if (answers.length === 0 || answers.some(({ address }) => isLocalOrPrivateAddress(address))) {
    throw new Error(LOCAL_ADDRESS_BLOCKED_MESSAGE)
  }
}

/**
 * Applies the destination rule to every browser request, including redirects,
 * iframes and subresources. Results are cached per context to avoid resolving
 * the same asset host for every request.
 */
export async function protectBrowserContext(context: BrowserContext, allowLocalAddresses: boolean): Promise<void> {
  if (allowLocalAddresses) return
  const checks = new Map<string, Promise<void>>()
  await context.route('**/*', async (route) => {
    const url = route.request().url()
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      await route.abort('blockedbyclient')
      return
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      await route.continue()
      return
    }

    const key = `${parsed.protocol}//${parsed.hostname}:${parsed.port}`
    let check = checks.get(key)
    if (!check) {
      check = assertRemoteNetworkUrl(url)
      checks.set(key, check)
    }
    try {
      await check
      await route.continue()
    } catch (err) {
      appLogger.warn(`Blocked browser request to ${url}: ${String(err)}`)
      await route.abort('blockedbyclient')
    }
  })
}

import type { JobSource } from '@shared/types/jobSource'

export type { JobSource }

/** `hostname` is `domain` itself or a subdomain of it; `evil-domain.com` and `domain.com.evil` are neither. */
function isHostUnder(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

/**
 * Which adapter a URL belongs to. National editions of the aggregators are
 * subdomains (`au.indeed.com`, `uk.jora.com`, `nz.prosple.com`), so those are
 * matched by domain rather than by an exact hostname. Seek's older
 * per-country domains are kept alongside `seek.com` since links to them are
 * still everywhere and still resolve.
 */
export function detectSource(url: string): JobSource {
  let hostname: string
  try {
    hostname = new URL(url).hostname.toLowerCase()
  } catch {
    return 'generic'
  }

  if (hostname === 'boards.greenhouse.io' || hostname === 'job-boards.greenhouse.io' || hostname === 'boards-api.greenhouse.io') {
    return 'greenhouse'
  }
  if (hostname === 'jobs.lever.co' || hostname === 'api.lever.co') {
    return 'lever'
  }
  if (hostname === 'jobs.ashbyhq.com' || hostname === 'api.ashbyhq.com') {
    return 'ashby'
  }
  if (hostname.endsWith('.myworkdayjobs.com')) {
    return 'workday'
  }
  if (hostname === 'www.linkedin.com' || hostname === 'linkedin.com') {
    return 'linkedin'
  }
  if (isHostUnder(hostname, 'indeed.com')) {
    return 'indeed'
  }
  if (isHostUnder(hostname, 'seek.com') || isHostUnder(hostname, 'seek.com.au') || isHostUnder(hostname, 'seek.co.nz')) {
    return 'seek'
  }
  if (isHostUnder(hostname, 'jora.com')) {
    return 'jora'
  }
  if (isHostUnder(hostname, 'prosple.com')) {
    return 'prosple'
  }
  if (isHostUnder(hostname, 'remotive.com') || isHostUnder(hostname, 'remotive.io')) {
    return 'remotive'
  }
  return 'generic'
}

/** Parses `boards.greenhouse.io/{token}/jobs/{id}` (or the job-boards.* variant) into its parts. */
export function parseGreenhouseUrl(url: string): { token: string; jobId: string } | null {
  const match = new URL(url).pathname.match(/^\/([^/]+)\/jobs\/(\d+)/)
  if (!match) return null
  return { token: match[1]!, jobId: match[2]! }
}

/** Parses `jobs.lever.co/{token}/{postingId}`. */
export function parseLeverUrl(url: string): { token: string; postingId: string } | null {
  const match = new URL(url).pathname.match(/^\/([^/]+)\/([0-9a-f-]{36})/i)
  if (!match) return null
  return { token: match[1]!, postingId: match[2]! }
}

/** Parses `jobs.ashbyhq.com/{token}/{postingId}`. */
export function parseAshbyUrl(url: string): { token: string; postingId: string } | null {
  const match = new URL(url).pathname.match(/^\/([^/]+)\/([0-9a-f-]{36})/i)
  if (!match) return null
  return { token: match[1]!, postingId: match[2]! }
}

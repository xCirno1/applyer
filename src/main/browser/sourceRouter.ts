export type JobSource = 'greenhouse' | 'lever' | 'ashby' | 'workday' | 'linkedin' | 'indeed' | 'generic'

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
  if (hostname === 'www.indeed.com' || hostname === 'indeed.com') {
    return 'indeed'
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

import { parseAshbyUrl } from '../sourceRouter'
import { htmlToPlainText, sanitizeDescriptionHtml } from '../htmlContent'
import type { JobDetailsOutcome } from '../types'

interface AshbyPosting {
  id: string
  title: string
  location?: string
  isRemote?: boolean
  jobUrl: string
  applyUrl: string
  descriptionHtml?: string
}

interface AshbyBoard {
  jobs: AshbyPosting[]
}

/**
 * Ashby's public job-board API only exposes a whole-board listing, not a
 * single-posting-by-id endpoint, so fetching one job's details means
 * fetching the board and finding it — acceptable since boards are small.
 */
export async function fetchAshbyJobDetails(url: string): Promise<JobDetailsOutcome> {
  const parsed = parseAshbyUrl(url)
  if (!parsed) {
    return { status: 'not_found', message: 'URL does not look like an Ashby job posting.' }
  }

  let response: Response
  try {
    response = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(parsed.token)}`, {
      headers: { Accept: 'application/json' }
    })
  } catch (err) {
    return { status: 'not_found', message: `Failed to reach Ashby API: ${String(err)}` }
  }

  if (!response.ok) {
    return { status: 'not_found', message: `Ashby API returned HTTP ${response.status}.` }
  }

  const board = (await response.json()) as AshbyBoard
  const posting = board.jobs.find((j) => j.id === parsed.postingId)
  if (!posting) {
    return { status: 'not_found', message: 'This Ashby posting is no longer listed on the board; it may have closed.' }
  }

  const html = sanitizeDescriptionHtml(posting.descriptionHtml ?? '')

  return {
    status: 'ok',
    details: {
      title: posting.title,
      company: parsed.token,
      location: posting.location,
      description: html,
      descriptionText: htmlToPlainText(html),
      applicationUrl: posting.applyUrl ?? posting.jobUrl,
      detectedAts: 'ashby',
      requiresLogin: false,
      applyMethod: 'external_form'
    }
  }
}

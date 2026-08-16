import { parseGreenhouseUrl } from '../sourceRouter'
import { decodeHtmlEntities, htmlToPlainText, sanitizeDescriptionHtml } from '../htmlContent'
import type { JobDetailsOutcome } from '../types'

interface GreenhouseJob {
  id: number
  title: string
  content?: string
  absolute_url: string
  location?: { name?: string }
  company_name?: string
}

/** Greenhouse's public, unauthenticated job board API — no scraping needed. */
export async function fetchGreenhouseJobDetails(url: string): Promise<JobDetailsOutcome> {
  const parsed = parseGreenhouseUrl(url)
  if (!parsed) {
    return { status: 'not_found', message: 'URL does not look like a Greenhouse job posting.' }
  }

  const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(parsed.token)}/jobs/${encodeURIComponent(parsed.jobId)}?content=true`

  let response: Response
  try {
    response = await fetch(apiUrl, { headers: { Accept: 'application/json' } })
  } catch (err) {
    return { status: 'not_found', message: `Failed to reach Greenhouse API: ${String(err)}` }
  }

  if (response.status === 404) {
    return { status: 'not_found', message: 'This Greenhouse posting no longer exists (404).' }
  }
  if (!response.ok) {
    return { status: 'not_found', message: `Greenhouse API returned HTTP ${response.status}.` }
  }

  const job = (await response.json()) as GreenhouseJob
  const rawHtml = job.content ? decodeHtmlEntities(job.content) : ''
  const html = sanitizeDescriptionHtml(rawHtml)

  return {
    status: 'ok',
    details: {
      title: job.title,
      company: job.company_name ?? parsed.token,
      location: job.location?.name,
      description: html,
      descriptionText: htmlToPlainText(html),
      applicationUrl: job.absolute_url,
      detectedAts: 'greenhouse',
      requiresLogin: false,
      applyMethod: 'external_form'
    }
  }
}

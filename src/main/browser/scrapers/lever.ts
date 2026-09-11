import { parseLeverUrl } from '../sourceRouter'
import { htmlToPlainText, sanitizeDescriptionHtml } from '../htmlContent'
import type { JobDetailsOutcome } from '../types'

interface LeverPosting {
  id: string
  text: string
  hostedUrl: string
  applyUrl?: string
  categories?: { location?: string; team?: string; commitment?: string; department?: string }
  description?: string
  descriptionPlain?: string
  lists?: { text: string; content: string }[]
}

function buildFullHtml(posting: LeverPosting): string {
  const sections = [posting.description ?? '']
  for (const item of posting.lists ?? []) {
    sections.push(`<h3>${item.text}</h3>${item.content}`)
  }
  return sections.join('\n')
}

async function fetchJson(url: string): Promise<Response> {
  return fetch(url, { headers: { Accept: 'application/json' } })
}

/** Lever's public, unauthenticated postings API — no scraping needed. */
export async function fetchLeverJobDetails(url: string): Promise<JobDetailsOutcome> {
  const parsed = parseLeverUrl(url)
  if (!parsed) {
    return { status: 'not_found', message: 'URL does not look like a Lever job posting.' }
  }

  let response: Response
  try {
    response = await fetchJson(
      `https://api.lever.co/v0/postings/${encodeURIComponent(parsed.token)}/${encodeURIComponent(parsed.postingId)}?mode=json`
    )
  } catch (err) {
    return { status: 'not_found', message: `Failed to reach Lever API: ${String(err)}` }
  }

  if (response.status === 404) {
    return { status: 'not_found', message: 'This Lever posting no longer exists (404); it may have closed.' }
  }
  if (!response.ok) {
    return { status: 'not_found', message: `Lever API returned HTTP ${response.status}.` }
  }

  const posting = (await response.json()) as LeverPosting
  const html = sanitizeDescriptionHtml(buildFullHtml(posting))

  return {
    status: 'ok',
    details: {
      title: posting.text,
      company: parsed.token,
      location: posting.categories?.location,
      description: html,
      descriptionText: htmlToPlainText(html),
      applicationUrl: posting.applyUrl ?? posting.hostedUrl,
      detectedAts: 'lever',
      requiresLogin: false,
      applyMethod: 'external_form'
    }
  }
}

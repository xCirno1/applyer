import { newHeadlessContext } from '../browserController'
import { detectCaptcha } from '../captchaDetector'
import { htmlToPlainText, sanitizeDescriptionHtml } from '../htmlContent'
import type { JobDetailsOutcome, JobSearchResultItem } from '../types'

interface RawLinkedInCard {
  id: string | null
  title?: string
  company?: string
  location?: string
  listedAt?: string | null
}

export interface LinkedInSearchResult {
  results: JobSearchResultItem[]
  blocked: boolean
  warning?: string
}

export async function searchLinkedIn(
  query: string,
  location: string | undefined,
  limit: number
): Promise<LinkedInSearchResult> {
  const context = await newHeadlessContext()
  try {
    const page = await context.newPage()
    const params = new URLSearchParams({ keywords: query })
    if (location) params.set('location', location)

    await page.goto(`https://www.linkedin.com/jobs/search/?${params.toString()}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000
    })

    const captcha = await detectCaptcha(page)
    if (captcha.blocked) {
      return { results: [], blocked: true, warning: `linkedin: blocked by a verification challenge (${captcha.reason})` }
    }

    const cards = await page.evaluate((): RawLinkedInCard[] => {
      const items: RawLinkedInCard[] = []
      document.querySelectorAll('.job-search-card').forEach((el) => {
        const urn = el.getAttribute('data-entity-urn')
        const id = urn ? (urn.split(':').pop() ?? null) : null
        const title = el.querySelector('.base-search-card__title')?.textContent?.trim()
        const company = el.querySelector('.base-search-card__subtitle')?.textContent?.trim()
        const location = el.querySelector('.job-search-card__location')?.textContent?.trim()
        const listedAt = el.querySelector('time')?.getAttribute('datetime')
        items.push({ id, title, company, location, listedAt })
      })
      return items
    })

    const results: JobSearchResultItem[] = cards
      .filter((c): c is RawLinkedInCard & { id: string; title: string; company: string } => !!c.id && !!c.title && !!c.company)
      .slice(0, limit)
      .map((c) => ({
        title: c.title,
        company: c.company,
        location: c.location,
        url: `https://www.linkedin.com/jobs/view/${c.id}`,
        source: 'linkedin',
        postedAt: c.listedAt ?? undefined,
        snippet: ''
      }))

    return { results, blocked: false }
  } finally {
    await context.close()
  }
}

export async function fetchLinkedInJobDetails(url: string): Promise<JobDetailsOutcome> {
  const context = await newHeadlessContext()
  try {
    const page = await context.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })

    const captcha = await detectCaptcha(page)
    if (captcha.blocked) {
      return {
        status: 'blocked',
        reasonTag: 'captcha_verification',
        message: `LinkedIn presented a verification challenge (${captcha.reason}).`
      }
    }

    const data = await page.evaluate(() => ({
      title: document.querySelector('h1')?.textContent?.trim() ?? '',
      company:
        document.querySelector('.topcard__org-name-link')?.textContent?.trim() ??
        document.querySelector('.top-card-layout__second-subline a')?.textContent?.trim() ??
        '',
      location: document.querySelector('.topcard__flavor--bullet')?.textContent?.trim(),
      descriptionHtml:
        document.querySelector('.description__text')?.innerHTML ??
        document.querySelector('.show-more-less-html__markup')?.innerHTML ??
        ''
    }))

    if (!data.descriptionHtml) {
      return {
        status: 'not_found',
        message: 'Could not find a job description on this LinkedIn page; it may require sign-in or have expired.'
      }
    }

    const html = sanitizeDescriptionHtml(data.descriptionHtml)
    return {
      status: 'ok',
      details: {
        title: data.title,
        company: data.company,
        location: data.location,
        description: html,
        descriptionText: htmlToPlainText(html),
        applicationUrl: url,
        detectedAts: 'linkedin',
        requiresLogin: false,
        applyMethod: 'easy_apply'
      }
    }
  } finally {
    await context.close()
  }
}

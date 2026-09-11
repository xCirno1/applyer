import { newHeadlessContext } from '../browserController'
import { detectCaptcha } from '../captchaDetector'
import { htmlToPlainText, sanitizeDescriptionHtml } from '../htmlContent'
import type { JobDetailsOutcome, JobSearchResultItem } from '../types'

interface RawIndeedCard {
  jk: string | null
  title?: string
  company?: string
  location?: string
  snippet?: string
}

export interface IndeedSearchResult {
  results: JobSearchResultItem[]
  blocked: boolean
  warning?: string
}

export async function searchIndeed(query: string, location: string | undefined, limit: number): Promise<IndeedSearchResult> {
  const context = await newHeadlessContext()
  try {
    const page = await context.newPage()
    const params = new URLSearchParams({ q: query })
    if (location) params.set('l', location)

    await page.goto(`https://www.indeed.com/jobs?${params.toString()}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000
    })

    const captcha = await detectCaptcha(page)
    if (captcha.blocked) {
      return { results: [], blocked: true, warning: `indeed: blocked by a verification challenge (${captcha.reason})` }
    }

    const cards = await page.evaluate((): RawIndeedCard[] => {
      const items: RawIndeedCard[] = []
      document.querySelectorAll('[data-jk]').forEach((el) => {
        const node = el.closest('.job_seen_beacon') ?? el.closest('.cardOutline') ?? el.closest('li') ?? el.parentElement
        if (!node) return
        const title =
          node.querySelector('h2.jobTitle span, .jobTitle span')?.textContent?.trim() ??
          node.querySelector('h2.jobTitle')?.textContent?.trim()
        const company = node.querySelector('[data-testid="company-name"]')?.textContent?.trim()
        const location = node.querySelector('[data-testid="text-location"]')?.textContent?.trim()
        const snippet = node.querySelector('[data-testid="jobsnippet_footer"], .job-snippet')?.textContent?.trim()
        items.push({ jk: el.getAttribute('data-jk'), title, company, location, snippet })
      })
      return items
    })

    const results: JobSearchResultItem[] = cards
      .filter((c): c is RawIndeedCard & { jk: string; title: string; company: string } => !!c.jk && !!c.title && !!c.company)
      .slice(0, limit)
      .map((c) => ({
        title: c.title,
        company: c.company,
        location: c.location,
        url: `https://www.indeed.com/viewjob?jk=${c.jk}`,
        source: 'indeed',
        snippet: c.snippet ?? ''
      }))

    return { results, blocked: false }
  } finally {
    await context.close()
  }
}

export async function fetchIndeedJobDetails(url: string): Promise<JobDetailsOutcome> {
  const context = await newHeadlessContext()
  try {
    const page = await context.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })

    const captcha = await detectCaptcha(page)
    if (captcha.blocked) {
      return {
        status: 'blocked',
        reasonTag: 'captcha_verification',
        message: `Indeed presented a verification challenge (${captcha.reason}).`
      }
    }

    const data = await page.evaluate(() => ({
      title: document.querySelector('h1')?.textContent?.trim() ?? '',
      company:
        document.querySelector('[data-testid="inlineHeader-companyName"]')?.textContent?.trim() ??
        document.querySelector('[data-company-name]')?.textContent?.trim() ??
        '',
      location: document.querySelector('[data-testid="inlineHeader-companyLocation"]')?.textContent?.trim(),
      descriptionHtml: document.querySelector('#jobDescriptionText')?.innerHTML ?? ''
    }))

    if (!data.descriptionHtml) {
      return { status: 'not_found', message: 'Could not find a job description on this Indeed page; it may have expired.' }
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
        detectedAts: 'indeed',
        requiresLogin: false,
        applyMethod: 'external_form'
      }
    }
  } finally {
    await context.close()
  }
}

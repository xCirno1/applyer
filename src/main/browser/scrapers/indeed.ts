import { newHeadlessContext } from '../browserController'
import { detectCaptcha } from '../captchaDetector'
import { readSearchPage } from '../searchPage'
import { htmlToPlainText, sanitizeDescriptionHtml } from '../htmlContent'
import { aggregatorHost } from '@shared/types/jobSource'
import type { AggregatorSearchParams, AggregatorSearchResult, JobDetailsOutcome, JobSearchResultItem } from '../types'

interface RawIndeedCard {
  jk: string | null
  title?: string
  company?: string
  location?: string
  snippet?: string
}

/**
 * Indeed is one site per country, each with its own index, so the search
 * goes to the edition for the configured country (`au.indeed.com`,
 * `uk.indeed.com`); a result's URL is built on the same host so that
 * `get_job_details` lands on the edition that has the posting.
 */
export async function searchIndeed(params: AggregatorSearchParams): Promise<AggregatorSearchResult> {
  const host = aggregatorHost('indeed', params.country)
  if (!host) {
    return { results: [], blocked: false, warning: `indeed: no edition for country "${params.country}"` }
  }
  const { query, location, limit } = params

  const search = new URLSearchParams({ q: query })
  if (location) search.set('l', location)

  const outcome = await readSearchPage({
    source: 'indeed',
    host,
    url: `https://${host}/jobs?${search.toString()}`,
    read: (page) =>
      page.evaluate((): RawIndeedCard[] => {
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
  })
  if (outcome.status === 'blocked') return { results: [], blocked: true, warning: outcome.warning }

  const results: JobSearchResultItem[] = outcome.value
    .filter((c): c is RawIndeedCard & { jk: string; title: string; company: string } => !!c.jk && !!c.title && !!c.company)
    .slice(0, limit)
    .map((c) => ({
      title: c.title,
      company: c.company,
      location: c.location,
      url: `https://${host}/viewjob?jk=${c.jk}`,
      source: 'indeed',
      snippet: c.snippet ?? ''
    }))

  return { results, blocked: false }
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

import { newHeadlessContext } from '../browserController'
import { detectCaptcha } from '../captchaDetector'
import { htmlToPlainText, sanitizeDescriptionHtml } from '../htmlContent'
import type { JobDetailsOutcome } from '../types'

const DESCRIPTION_SELECTORS = [
  '[data-automation-id="jobPostingDescription"]', // Workday
  '.job-description',
  '#job-description',
  '.posting',
  '.posting-description',
  'article',
  'main',
  '[role="main"]'
]

/**
 * Best-effort fallback for any career-page URL we don't have a dedicated
 * adapter for (arbitrary company sites, Workday tenants, etc). Success
 * varies a lot by site — this is deliberately a fallback, not a promise.
 */
export async function fetchGenericJobDetails(url: string): Promise<JobDetailsOutcome> {
  const context = await newHeadlessContext()
  try {
    const page = await context.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForTimeout(1000)

    const captcha = await detectCaptcha(page)
    if (captcha.blocked) {
      return {
        status: 'blocked',
        reasonTag: 'captcha_verification',
        message: `This page presented a verification challenge (${captcha.reason}).`
      }
    }

    const data = await page.evaluate((selectors: string[]) => {
      let container: Element | null = null
      for (const selector of selectors) {
        const el = document.querySelector(selector)
        if (el && (el.textContent?.trim().length ?? 0) > 100) {
          container = el
          break
        }
      }
      const titleEl =
        document.querySelector('[data-automation-id="jobPostingHeader"]') ?? document.querySelector('h1')
      return {
        title: titleEl?.textContent?.trim() ?? document.title,
        html: container?.innerHTML ?? document.body?.innerHTML ?? ''
      }
    }, DESCRIPTION_SELECTORS)

    if (!data.html || data.html.trim().length < 50) {
      return {
        status: 'not_found',
        message: 'Could not find enough page content to treat this as a job posting.'
      }
    }

    const html = sanitizeDescriptionHtml(data.html)
    return {
      status: 'ok',
      details: {
        title: data.title,
        company: new URL(url).hostname.replace(/^www\./, ''),
        description: html,
        descriptionText: htmlToPlainText(html).slice(0, 20000),
        applicationUrl: url,
        detectedAts: 'generic',
        requiresLogin: false,
        applyMethod: 'unknown'
      }
    }
  } finally {
    await context.close()
  }
}

import { newHeadlessContext } from '../browserController'
import { detectCaptcha } from '../captchaDetector'
import { htmlToPlainText, sanitizeDescriptionHtml } from '../htmlContent'
import type { JobDetailsOutcome } from '../types'

function companyFromWorkdayHost(url: string): string {
  const host = new URL(url).hostname
  return host.split('.')[0] ?? host
}

/**
 * Workday tenants are heavily customized SPAs, but Workday's own component
 * framework consistently emits `data-automation-id="jobPostingDescription"`
 * / `jobPostingHeader` regardless of tenant styling, so those are worth
 * trying before falling back to a generic content guess.
 */
export async function fetchWorkdayJobDetails(url: string): Promise<JobDetailsOutcome> {
  const context = await newHeadlessContext()
  try {
    const page = await context.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 })
    // Workday renders its posting content client-side after an XHR — a fixed
    // navigation wait isn't reliable, so wait for the known container instead.
    await page
      .waitForSelector('[data-automation-id="jobPostingDescription"]', { timeout: 8000 })
      .catch(() => {})

    const captcha = await detectCaptcha(page)
    if (captcha.blocked) {
      return {
        status: 'blocked',
        reasonTag: 'captcha_verification',
        message: `This Workday site presented a verification challenge (${captcha.reason}).`
      }
    }

    const data = await page.evaluate(() => ({
      title:
        document.querySelector('[data-automation-id="jobPostingHeader"]')?.textContent?.trim() ??
        document.querySelector('h1')?.textContent?.trim() ??
        document.title,
      location: document.querySelector('[data-automation-id="locations"]')?.textContent?.trim(),
      html: document.querySelector('[data-automation-id="jobPostingDescription"]')?.innerHTML ?? ''
    }))

    if (!data.html) {
      return {
        status: 'not_found',
        message: 'Could not find the job description container on this Workday page; the tenant may use a non-standard layout.'
      }
    }

    const html = sanitizeDescriptionHtml(data.html)
    return {
      status: 'ok',
      details: {
        title: data.title,
        company: companyFromWorkdayHost(url),
        location: data.location,
        description: html,
        descriptionText: htmlToPlainText(html),
        applicationUrl: url,
        detectedAts: 'workday',
        requiresLogin: false,
        applyMethod: 'external_form'
      }
    }
  } finally {
    await context.close()
  }
}

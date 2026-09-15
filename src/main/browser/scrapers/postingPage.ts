import type { Page } from 'playwright'
import { newHeadlessContext } from '../browserController'
import { detectCaptcha } from '../captchaDetector'
import { htmlToPlainText, sanitizeDescriptionHtml } from '../htmlContent'
import { collectJsonLdScripts, extractPostingDom, type PostingSelectors } from './dom/posting'
import { parseJobPostingLd } from './jsonLd'
import type { JobDetailsOutcome } from '../types'
import type { ApplyMethod } from '@shared/types/job'

/**
 * Reading one posting page through the browser: the common path behind
 * Seek, Jora and Prosple's `get_job_details`.
 *
 * Every field is taken from the page's schema.org `JobPosting` block first
 * and from the site's own markup second (see `jsonLd.ts` for why that
 * order). The one exception is the description: the visible container is
 * preferred when both exist, since the JSON-LD copy is what the site chose
 * to feed search engines and is sometimes flattened to text, while the
 * on-page one is what an applicant reads.
 */
export interface PostingPageSpec {
  /** For messages: "Seek". */
  label: string
  /** Stored as `detectedAts`. */
  source: string
  selectors: PostingSelectors
  applyMethod: ApplyMethod
  /** Something the rendered page will contain, waited for briefly so a client-rendered page has settled. */
  waitFor?: string
  /** A last resort for the company name when neither the JSON-LD nor the selectors had one. */
  companyFallback?: (page: Page) => Promise<string | null>
}

const NAVIGATION_TIMEOUT_MS = 20000
const SETTLE_TIMEOUT_MS = 6000

export async function readPostingPage(url: string, spec: PostingPageSpec): Promise<JobDetailsOutcome> {
  const context = await newHeadlessContext()
  try {
    const page = await context.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS })
    if (spec.waitFor) {
      // Only a settle, never a failure: the JSON-LD block is in the initial
      // HTML even when the visible content is rendered later.
      await page.waitForSelector(spec.waitFor, { timeout: SETTLE_TIMEOUT_MS }).catch(() => undefined)
    }

    const captcha = await detectCaptcha(page)
    if (captcha.blocked) {
      return {
        status: 'blocked',
        reasonTag: 'captcha_verification',
        message: `${spec.label} presented a verification challenge (${captcha.reason}).`
      }
    }

    const ld = parseJobPostingLd(await page.evaluate(collectJsonLdScripts, null))
    const dom = await page.evaluate(extractPostingDom, spec.selectors)

    const descriptionHtml = dom.descriptionHtml ?? ld?.descriptionHtml ?? null
    if (!descriptionHtml) {
      return {
        status: 'not_found',
        message: `Could not find a job description on this ${spec.label} page; it may have expired or been removed.`
      }
    }

    let company = ld?.company ?? dom.company ?? null
    if (!company && spec.companyFallback) company = await spec.companyFallback(page)

    const html = sanitizeDescriptionHtml(descriptionHtml)
    const salary = ld?.salary ?? dom.salary ?? undefined
    return {
      status: 'ok',
      details: {
        title: ld?.title ?? dom.title ?? '',
        company: company ?? '',
        location: ld?.location ?? dom.location ?? undefined,
        description: html,
        descriptionText: htmlToPlainText(html),
        applicationUrl: url,
        detectedAts: spec.source,
        requiresLogin: false,
        applyMethod: spec.applyMethod,
        ...(salary ? { salaryRange: salary } : {})
      }
    }
  } finally {
    await context.close()
  }
}

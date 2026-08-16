import type { Page } from 'playwright'

export interface CaptchaCheckResult {
  blocked: boolean
  reason?: string
}

const CHALLENGE_TEXT_PATTERN =
  /verify you are human|are you a robot|checking your browser|attention required|unusual traffic|complete the security check|access denied.{0,40}captcha|please verify you are a human/i

const CHALLENGE_SELECTORS = [
  'div.g-recaptcha',
  'iframe[src*="recaptcha" i]',
  'iframe[src*="hcaptcha" i]',
  'iframe[title*="challenge" i]',
  '#challenge-form',
  '#challenge-running',
  '#px-captcha',
  '[data-sitekey]'
]

/**
 * Heuristic bot-check/CAPTCHA detection: known challenge iframes, obvious
 * "prove you're human" copy, and common challenge widget selectors. Not
 * exhaustive — sites change markup — but good enough to distinguish "this
 * page is blocked" from "this page just looks unusual."
 */
export async function detectCaptcha(page: Page): Promise<CaptchaCheckResult> {
  for (const frame of page.frames()) {
    const url = frame.url()
    if (/recaptcha|hcaptcha|challenges\.cloudflare|arkoselabs|perimeterx/i.test(url)) {
      return { blocked: true, reason: 'challenge_iframe' }
    }
  }

  for (const selector of CHALLENGE_SELECTORS) {
    try {
      const count = await page.locator(selector).count()
      if (count > 0) {
        return { blocked: true, reason: 'challenge_selector' }
      }
    } catch {
      // Selector evaluation can race a mid-navigation page — not itself a signal.
    }
  }

  const bodyText = await page
    .evaluate(() => document.body?.innerText?.slice(0, 3000) ?? '')
    .catch(() => '')
  if (CHALLENGE_TEXT_PATTERN.test(bodyText)) {
    return { blocked: true, reason: 'challenge_text' }
  }

  return { blocked: false }
}

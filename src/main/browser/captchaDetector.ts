import type { Page } from 'playwright'

export interface CaptchaCheckResult {
  blocked: boolean
  reason?: string
}

const CHALLENGE_TEXT_PATTERN =
  /verify you are human|are you a robot|checking your browser|attention required|unusual traffic|complete the security check|access denied.{0,40}captcha|please verify you are a human/i

// Selectors for actual challenge widgets/containers (not badges) — existence alone is a signal.
const CHALLENGE_SELECTORS = ['div.g-recaptcha', '#challenge-form', '#challenge-running', '#px-captcha', '[data-sitekey]']

// iframe-based signals need the visibility/size gate below: vendors like reCAPTCHA embed a
// persistent, tiny "protected by..." badge iframe on every page they cover, challenge or not —
// matching on src alone flags pages with nothing to solve.
const CHALLENGE_IFRAME_SELECTORS = ['iframe[src*="recaptcha" i]', 'iframe[src*="hcaptcha" i]', 'iframe[title*="challenge" i]']

// reCAPTCHA's persistent anchor/badge iframe (the small "protected by reCAPTCHA" corner badge)
// is present on every page it protects, challenge or not. Only its "bframe" iframe — opened
// when a checkbox/image-grid challenge is actually shown — means something needs solving.
const BADGE_FRAME_URL_PATTERN = /recaptcha\/(?:api2|enterprise)\/anchor/i

// Badges are small and pinned to a corner (reCAPTCHA's is ~256x60px); a real challenge iframe
// (checkbox popup, image grid, full-page "checking your browser" interstitial) is meaningfully
// bigger. Used to tell the two apart without hardcoding every vendor's exact markup.
const MIN_CHALLENGE_DIMENSION_PX = 100

interface SizableElement {
  isVisible(): Promise<boolean>
  boundingBox(): Promise<{ width: number; height: number } | null>
}

async function isVisibleAndChallengeSized(element: SizableElement): Promise<boolean> {
  if (!(await element.isVisible())) return false
  const box = await element.boundingBox()
  return !!box && box.width >= MIN_CHALLENGE_DIMENSION_PX && box.height >= MIN_CHALLENGE_DIMENSION_PX
}

/**
 * Heuristic bot-check/CAPTCHA detection: known challenge iframes, obvious
 * "prove you're human" copy, and common challenge widget selectors. Not
 * exhaustive — sites change markup — but good enough to distinguish "this
 * page is blocked" from "this page just looks unusual."
 */
export async function detectCaptcha(page: Page): Promise<CaptchaCheckResult> {
  for (const frame of page.frames()) {
    const url = frame.url()
    if (!/recaptcha|hcaptcha|challenges\.cloudflare|arkoselabs|perimeterx/i.test(url)) continue
    if (BADGE_FRAME_URL_PATTERN.test(url)) continue
    try {
      const element = await frame.frameElement()
      if (await isVisibleAndChallengeSized(element)) {
        return { blocked: true, reason: 'challenge_iframe' }
      }
    } catch {
      // frameElement() can race a detached/mid-navigation frame — not itself a signal.
    }
  }

  for (const selector of CHALLENGE_IFRAME_SELECTORS) {
    try {
      const locator = page.locator(selector).first()
      if ((await locator.count()) === 0) continue
      if (await isVisibleAndChallengeSized(locator)) {
        return { blocked: true, reason: 'challenge_selector' }
      }
    } catch {
      // Selector evaluation can race a mid-navigation page — not itself a signal.
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

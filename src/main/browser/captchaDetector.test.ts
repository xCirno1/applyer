import { describe, it, expect, vi } from 'vitest'
import type { Page } from 'playwright'
import { detectCaptcha } from './captchaDetector'

interface FakePageOptions {
  frameUrls?: string[]
  /** selector -> match count. Any selector not listed here counts as 0. */
  selectorCounts?: Record<string, number>
  /** Selectors in this set throw instead of returning a count. */
  throwingSelectors?: Set<string>
  bodyText?: string
  bodyTextThrows?: boolean
}

function fakePage(opts: FakePageOptions = {}): { page: Page; locatorSpy: ReturnType<typeof vi.fn> } {
  const { frameUrls = [], selectorCounts = {}, throwingSelectors = new Set(), bodyText = '', bodyTextThrows = false } = opts

  const locatorSpy = vi.fn((selector: string) => ({
    count: async () => {
      if (throwingSelectors.has(selector)) throw new Error('locator race')
      return selectorCounts[selector] ?? 0
    }
  }))

  const page = {
    frames: () => frameUrls.map((url) => ({ url: () => url })),
    locator: locatorSpy,
    evaluate: async () => {
      if (bodyTextThrows) throw new Error('page navigated mid-evaluate')
      return bodyText
    }
  } as unknown as Page

  return { page, locatorSpy }
}

describe('detectCaptcha', () => {
  it('reports not blocked when nothing matches', async () => {
    const { page } = fakePage()
    await expect(detectCaptcha(page)).resolves.toEqual({ blocked: false })
  })

  it('detects a known challenge iframe by frame URL', async () => {
    const { page, locatorSpy } = fakePage({ frameUrls: ['https://www.google.com/recaptcha/api2/anchor'] })
    await expect(detectCaptcha(page)).resolves.toEqual({ blocked: true, reason: 'challenge_iframe' })
    // Short-circuits before even checking selectors.
    expect(locatorSpy).not.toHaveBeenCalled()
  })

  it('detects hcaptcha/cloudflare/arkose/perimeterx iframe hosts too', async () => {
    for (const url of [
      'https://hcaptcha.com/challenge',
      'https://challenges.cloudflare.com/turnstile',
      'https://client-api.arkoselabs.com/x',
      'https://example.perimeterx.net/x'
    ]) {
      const { page } = fakePage({ frameUrls: [url] })
      await expect(detectCaptcha(page)).resolves.toEqual({ blocked: true, reason: 'challenge_iframe' })
    }
  })

  it('detects a known challenge selector on the page', async () => {
    const { page } = fakePage({ selectorCounts: { '#px-captcha': 1 } })
    await expect(detectCaptcha(page)).resolves.toEqual({ blocked: true, reason: 'challenge_selector' })
  })

  it('swallows a selector evaluation error and keeps checking rather than failing the whole check', async () => {
    const { page } = fakePage({
      throwingSelectors: new Set(['div.g-recaptcha']),
      selectorCounts: { '[data-sitekey]': 1 }
    })
    await expect(detectCaptcha(page)).resolves.toEqual({ blocked: true, reason: 'challenge_selector' })
  })

  it('detects "prove you are human" body copy when no iframe/selector matched', async () => {
    const { page } = fakePage({ bodyText: 'Please verify you are a human before continuing.' })
    await expect(detectCaptcha(page)).resolves.toEqual({ blocked: true, reason: 'challenge_text' })
  })

  it('treats a body-text evaluate() failure as "no signal" rather than blocked', async () => {
    const { page } = fakePage({ bodyTextThrows: true })
    await expect(detectCaptcha(page)).resolves.toEqual({ blocked: false })
  })

  it('is not fooled by unrelated body text', async () => {
    const { page } = fakePage({ bodyText: 'We are hiring a Senior Backend Engineer to join our team.' })
    await expect(detectCaptcha(page)).resolves.toEqual({ blocked: false })
  })
})

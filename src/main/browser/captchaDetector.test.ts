import { describe, it, expect, vi } from 'vitest'
import type { Page } from 'playwright'
import { detectCaptcha } from './captchaDetector'

interface ElementSpec {
  visible: boolean
  box: { width: number; height: number } | null
}

interface FrameSpec {
  url: string
  /** Omit to simulate frameElement() throwing (e.g. a detached/mid-navigation frame). */
  element?: ElementSpec
}

interface LocatorSpec {
  count?: number
  throws?: boolean
  visible?: boolean
  box?: { width: number; height: number } | null
}

interface FakePageOptions {
  frames?: FrameSpec[]
  /** selector -> behavior. Any selector not listed here counts as 0 / not visible. */
  locators?: Record<string, LocatorSpec>
  bodyText?: string
  bodyTextThrows?: boolean
}

const CHALLENGE_SIZED: ElementSpec = { visible: true, box: { width: 400, height: 500 } }
const BADGE_SIZED: ElementSpec = { visible: true, box: { width: 256, height: 60 } }

function fakeLocator(spec: LocatorSpec = {}): {
  first: () => ReturnType<typeof fakeLocator>
  count: () => Promise<number>
  isVisible: () => Promise<boolean>
  boundingBox: () => Promise<{ width: number; height: number } | null>
} {
  return {
    first: () => fakeLocator(spec),
    count: async () => {
      if (spec.throws) throw new Error('locator race')
      return spec.count ?? 0
    },
    isVisible: async () => {
      if (spec.throws) throw new Error('locator race')
      return spec.visible ?? false
    },
    boundingBox: async () => spec.box ?? null
  }
}

function fakePage(opts: FakePageOptions = {}): { page: Page; locatorSpy: ReturnType<typeof vi.fn> } {
  const { frames = [], locators = {}, bodyText = '', bodyTextThrows = false } = opts

  const locatorSpy = vi.fn((selector: string) => fakeLocator(locators[selector]))

  const page = {
    frames: () =>
      frames.map((spec) => ({
        url: () => spec.url,
        frameElement: async () => {
          if (!spec.element) throw new Error('frame detached')
          const element = spec.element
          return {
            isVisible: async () => element.visible,
            boundingBox: async () => element.box
          }
        }
      })),
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

  it('detects an actual reCAPTCHA challenge iframe (bframe), not just the badge', async () => {
    const { page, locatorSpy } = fakePage({
      frames: [{ url: 'https://www.google.com/recaptcha/api2/bframe?k=abc', element: CHALLENGE_SIZED }]
    })
    await expect(detectCaptcha(page)).resolves.toEqual({ blocked: true, reason: 'challenge_iframe' })
    // Short-circuits before even checking selectors.
    expect(locatorSpy).not.toHaveBeenCalled()
  })

  it('is not fooled by the persistent reCAPTCHA "protected by" anchor/badge iframe alone', async () => {
    const { page } = fakePage({
      frames: [{ url: 'https://www.google.com/recaptcha/api2/anchor?k=abc', element: BADGE_SIZED }]
    })
    await expect(detectCaptcha(page)).resolves.toEqual({ blocked: false })
  })

  it('is not fooled by a recaptcha-hosted iframe that is present but not visible/challenge-sized', async () => {
    const { page } = fakePage({
      frames: [{ url: 'https://www.google.com/recaptcha/api2/bframe?k=abc', element: { visible: false, box: null } }]
    })
    await expect(detectCaptcha(page)).resolves.toEqual({ blocked: false })
  })

  it('detects hcaptcha/cloudflare/arkose/perimeterx challenge iframes too', async () => {
    for (const url of [
      'https://hcaptcha.com/challenge',
      'https://challenges.cloudflare.com/turnstile',
      'https://client-api.arkoselabs.com/x',
      'https://example.perimeterx.net/x'
    ]) {
      const { page } = fakePage({ frames: [{ url, element: CHALLENGE_SIZED }] })
      await expect(detectCaptcha(page)).resolves.toEqual({ blocked: true, reason: 'challenge_iframe' })
    }
  })

  it('treats a detached/mid-navigation frame (frameElement() throws) as no signal', async () => {
    const { page } = fakePage({ frames: [{ url: 'https://hcaptcha.com/challenge' }] })
    await expect(detectCaptcha(page)).resolves.toEqual({ blocked: false })
  })

  it('detects a challenge-sized recaptcha iframe via selector when no frame matched', async () => {
    const { page } = fakePage({
      locators: { 'iframe[src*="recaptcha" i]': { count: 1, visible: true, box: { width: 300, height: 400 } } }
    })
    await expect(detectCaptcha(page)).resolves.toEqual({ blocked: true, reason: 'challenge_selector' })
  })

  it('is not fooled by a badge-sized recaptcha iframe via selector', async () => {
    const { page } = fakePage({
      locators: { 'iframe[src*="recaptcha" i]': { count: 1, visible: true, box: { width: 256, height: 60 } } }
    })
    await expect(detectCaptcha(page)).resolves.toEqual({ blocked: false })
  })

  it('detects a known challenge widget selector on the page', async () => {
    const { page } = fakePage({ locators: { '#px-captcha': { count: 1 } } })
    await expect(detectCaptcha(page)).resolves.toEqual({ blocked: true, reason: 'challenge_selector' })
  })

  it('swallows a selector evaluation error and keeps checking rather than failing the whole check', async () => {
    const { page } = fakePage({
      locators: {
        'div.g-recaptcha': { throws: true },
        '[data-sitekey]': { count: 1 }
      }
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

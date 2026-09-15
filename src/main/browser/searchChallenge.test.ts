import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Page } from 'playwright'

const mocks = vi.hoisted(() => ({
  openHeadedBrowser: vi.fn(),
  detectCaptcha: vi.fn(),
  broadcastDetected: vi.fn(),
  broadcastResolved: vi.fn(),
  recordRunEvent: vi.fn()
}))

vi.mock('./browserController', () => ({ openHeadedBrowser: mocks.openHeadedBrowser }))
vi.mock('./captchaDetector', () => ({ detectCaptcha: mocks.detectCaptcha }))
vi.mock('../ipc/jobsBroadcast', () => ({
  broadcastSearchChallengeDetected: mocks.broadcastDetected,
  broadcastSearchChallengeResolved: mocks.broadcastResolved
}))
vi.mock('../runs/runTracker', () => ({ recordRunEvent: mocks.recordRunEvent }))
vi.mock('../logger', () => ({ appLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { searchThroughChallenge } from './searchChallenge'
import { cancelGate, isGateOpen, resumeGate } from './captchaGate'

interface FakeSession {
  page: Page
  goto: ReturnType<typeof vi.fn>
  waitForSelector: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  newPage: ReturnType<typeof vi.fn>
}

function session(): FakeSession {
  const goto = vi.fn().mockResolvedValue(null)
  const waitForSelector = vi.fn().mockResolvedValue(null)
  const page = { goto, waitForSelector, isClosed: () => false } as unknown as Page
  const close = vi.fn().mockResolvedValue(undefined)
  const newPage = vi.fn().mockResolvedValue(page)
  mocks.openHeadedBrowser.mockResolvedValue({ browser: {}, newPage, close })
  return { page, goto, waitForSelector, close, newPage }
}

const request = {
  source: 'prosple' as const,
  host: 'au.prosple.com',
  url: 'https://au.prosple.com/search-jobs?keywords=intern',
  waitFor: 'a[href*="/jobs-internships/"]',
  read: vi.fn()
}

/** Lets the promise chain inside the module advance without moving the clock. */
const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0)
}

beforeEach(() => {
  vi.useFakeTimers()
  for (const mock of Object.values(mocks)) mock.mockReset()
  request.read.mockReset().mockResolvedValue(['card'])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('searchThroughChallenge', () => {
  it('reads the page straight away when the visible window is not challenged', async () => {
    const s = session()
    mocks.detectCaptcha.mockResolvedValue({ blocked: false })
    const outcome = await searchThroughChallenge(request)
    expect(outcome).toEqual({ status: 'ok', value: ['card'] })
    expect(s.goto).toHaveBeenCalledWith(request.url, expect.objectContaining({ waitUntil: 'domcontentloaded' }))
    expect(s.waitForSelector).toHaveBeenCalledWith(request.waitFor, expect.anything())
    expect(request.read).toHaveBeenCalledWith(s.page)
    // An attached browser that is not running must not cost the site.
    expect(mocks.openHeadedBrowser).toHaveBeenCalledWith({ whenUnreachable: 'launch' })
    expect(mocks.broadcastDetected).not.toHaveBeenCalled()
    expect(mocks.recordRunEvent).not.toHaveBeenCalled()
    expect(s.close).toHaveBeenCalledWith(s.page)
  })

  it('tells the user, waits for the challenge to clear on its own, then reads', async () => {
    const s = session()
    mocks.detectCaptcha
      .mockResolvedValueOnce({ blocked: true, reason: 'challenge_text' })
      .mockResolvedValueOnce({ blocked: true, reason: 'challenge_text' })
      .mockResolvedValue({ blocked: false })
    const pending = searchThroughChallenge(request)
    await flush()
    expect(mocks.broadcastDetected).toHaveBeenCalledWith({
      taskId: expect.stringMatching(/^search-/),
      source: 'prosple',
      host: 'au.prosple.com'
    })
    const taskId = mocks.broadcastDetected.mock.calls[0]?.[0].taskId as string
    expect(isGateOpen(taskId)).toBe(true)
    expect(mocks.recordRunEvent).toHaveBeenCalledWith('captcha_paused', {
      source: 'prosple',
      meta: { reason: 'challenge_text', search: true }
    })
    expect(request.read).not.toHaveBeenCalled()

    // First poll: still blocked. Second poll: clear.
    await vi.advanceTimersByTimeAsync(2000)
    expect(request.read).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000)

    await expect(pending).resolves.toEqual({ status: 'ok', value: ['card'] })
    expect(isGateOpen(taskId)).toBe(false)
    expect(mocks.broadcastResolved).toHaveBeenCalledWith({ taskId })
    expect(mocks.recordRunEvent).toHaveBeenCalledWith('captcha_resolved', { source: 'prosple', meta: { search: true } })
    // The listing is waited for again once the site lets the page through.
    expect(s.waitForSelector).toHaveBeenCalledTimes(2)
    expect(s.close).toHaveBeenCalledWith(s.page)
  })

  it('reads as soon as the banner resumes the gate', async () => {
    const s = session()
    mocks.detectCaptcha.mockResolvedValue({ blocked: true, reason: 'challenge_iframe' })
    const pending = searchThroughChallenge(request)
    await flush()
    const taskId = mocks.broadcastDetected.mock.calls[0]?.[0].taskId as string
    expect(resumeGate(taskId)).toBe(true)
    await expect(pending).resolves.toEqual({ status: 'ok', value: ['card'] })
    expect(s.close).toHaveBeenCalledWith(s.page)
  })

  it('reports blocked, and closes the page, when the user skips the site', async () => {
    const s = session()
    mocks.detectCaptcha.mockResolvedValue({ blocked: true, reason: 'challenge_text' })
    const pending = searchThroughChallenge(request)
    await flush()
    const taskId = mocks.broadcastDetected.mock.calls[0]?.[0].taskId as string
    expect(cancelGate(taskId)).toBe(true)
    const outcome = await pending
    expect(outcome.status).toBe('blocked')
    if (outcome.status === 'blocked') expect(outcome.warning).toMatch(/prosple: blocked by a verification challenge on au\.prosple\.com/)
    expect(request.read).not.toHaveBeenCalled()
    expect(mocks.broadcastResolved).toHaveBeenCalledWith({ taskId })
    expect(mocks.recordRunEvent).not.toHaveBeenCalledWith('captcha_resolved', expect.anything())
    expect(s.close).toHaveBeenCalledWith(s.page)
  })

  it('gives up after the timeout when nobody clears the challenge', async () => {
    session()
    mocks.detectCaptcha.mockResolvedValue({ blocked: true, reason: 'challenge_text' })
    const pending = searchThroughChallenge(request, 5000)
    await flush()
    const taskId = mocks.broadcastDetected.mock.calls[0]?.[0].taskId as string
    await vi.advanceTimersByTimeAsync(5000)
    const outcome = await pending
    expect(outcome.status).toBe('blocked')
    if (outcome.status === 'blocked') expect(outcome.warning).toMatch(/cancelled or timed out/)
    expect(isGateOpen(taskId)).toBe(false)
  })

  it('treats a detector failure while polling as still blocked', async () => {
    session()
    mocks.detectCaptcha
      .mockResolvedValueOnce({ blocked: true, reason: 'challenge_text' })
      .mockRejectedValueOnce(new Error('page navigating'))
      .mockResolvedValue({ blocked: false })
    const pending = searchThroughChallenge(request)
    await flush()
    await vi.advanceTimersByTimeAsync(2000)
    expect(request.read).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000)
    await expect(pending).resolves.toEqual({ status: 'ok', value: ['card'] })
  })

  it('opens one window at a time when two sources are challenged in the same search', async () => {
    const first = session()
    mocks.detectCaptcha.mockResolvedValue({ blocked: true, reason: 'challenge_text' })
    const a = searchThroughChallenge(request)
    await flush()
    const taskA = mocks.broadcastDetected.mock.calls[0]?.[0].taskId as string
    const b = searchThroughChallenge({ ...request, source: 'indeed', host: 'au.indeed.com' })
    await flush()
    // The second is queued behind the first, so only one window exists.
    expect(mocks.openHeadedBrowser).toHaveBeenCalledTimes(1)
    expect(mocks.broadcastDetected).toHaveBeenCalledTimes(1)

    const second = session()
    mocks.detectCaptcha.mockResolvedValue({ blocked: false })
    resumeGate(taskA)
    await expect(a).resolves.toEqual({ status: 'ok', value: ['card'] })
    expect(first.close).toHaveBeenCalled()
    await flush()
    expect(mocks.openHeadedBrowser).toHaveBeenCalledTimes(2)
    await expect(b).resolves.toEqual({ status: 'ok', value: ['card'] })
    expect(second.close).toHaveBeenCalled()
  })

  it('lets the next challenge run after one whose window failed to open', async () => {
    mocks.openHeadedBrowser.mockRejectedValueOnce(new Error('no browser'))
    await expect(searchThroughChallenge(request)).rejects.toThrow('no browser')
    session()
    mocks.detectCaptcha.mockResolvedValue({ blocked: false })
    await expect(searchThroughChallenge(request)).resolves.toEqual({ status: 'ok', value: ['card'] })
  })

  it('closes the page when the read itself throws', async () => {
    const s = session()
    mocks.detectCaptcha.mockResolvedValue({ blocked: false })
    request.read.mockRejectedValue(new Error('layout changed'))
    await expect(searchThroughChallenge(request)).rejects.toThrow('layout changed')
    expect(s.close).toHaveBeenCalledWith(s.page)
  })
})

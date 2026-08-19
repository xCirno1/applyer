import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Page } from 'playwright'
import { openGate, getGatePage, resumeGate, cancelGate, isGateOpen } from './captchaGate'

const fakePage = {} as Page

describe('captchaGate', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is not open before openGate is called', () => {
    expect(isGateOpen('never-opened')).toBe(false)
    expect(getGatePage('never-opened')).toBeUndefined()
  })

  it('resolves "resolved" when resumeGate is called', async () => {
    const promise = openGate('task-1', 'job-1', fakePage)
    expect(isGateOpen('task-1')).toBe(true)
    expect(getGatePage('task-1')).toBe(fakePage)

    expect(resumeGate('task-1')).toBe(true)
    await expect(promise).resolves.toBe('resolved')
    expect(isGateOpen('task-1')).toBe(false)
  })

  it('resolves "cancelled" when cancelGate is called', async () => {
    const promise = openGate('task-2', 'job-2', fakePage)
    expect(cancelGate('task-2')).toBe(true)
    await expect(promise).resolves.toBe('cancelled')
    expect(isGateOpen('task-2')).toBe(false)
  })

  it('resolves "cancelled" on its own after the timeout elapses', async () => {
    const promise = openGate('task-3', 'job-3', fakePage, 1000)
    expect(isGateOpen('task-3')).toBe(true)

    await vi.advanceTimersByTimeAsync(1000)

    await expect(promise).resolves.toBe('cancelled')
    expect(isGateOpen('task-3')).toBe(false)
  })

  it('resumeGate/cancelGate return false for an unknown or already-settled taskId', () => {
    expect(resumeGate('does-not-exist')).toBe(false)
    expect(cancelGate('does-not-exist')).toBe(false)
  })

  it('resumeGate after cancelGate is a no-op (already removed)', async () => {
    const promise = openGate('task-4', 'job-4', fakePage)
    expect(cancelGate('task-4')).toBe(true)
    expect(resumeGate('task-4')).toBe(false)
    await expect(promise).resolves.toBe('cancelled')
  })

  it('keeps separate tasks independent', async () => {
    const p1 = openGate('task-a', 'job-a', fakePage)
    const p2 = openGate('task-b', 'job-b', fakePage)

    expect(resumeGate('task-a')).toBe(true)
    expect(isGateOpen('task-a')).toBe(false)
    expect(isGateOpen('task-b')).toBe(true)

    expect(cancelGate('task-b')).toBe(true)
    await expect(p1).resolves.toBe('resolved')
    await expect(p2).resolves.toBe('cancelled')
  })
})

// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  DEFAULT_TOAST_INSET_PX,
  TOAST_INSET_GAP_PX,
  setToastInset,
  toastInsetStyle
} from './toastInset'

const readVariable = (): string => document.documentElement.style.getPropertyValue('--toast-inset-bottom')

beforeEach(() => {
  document.documentElement.style.removeProperty('--toast-inset-bottom')
})

describe('toastInsetStyle', () => {
  it('falls back to the corner inset when nothing has been reserved', () => {
    expect(toastInsetStyle().bottom).toBe(`var(--toast-inset-bottom, ${DEFAULT_TOAST_INSET_PX}px)`)
  })
})

describe('setToastInset', () => {
  it('reserves the chrome height plus a gap', () => {
    setToastInset(53)
    expect(readVariable()).toBe(`${53 + TOAST_INSET_GAP_PX}px`)
  })

  it('replaces a previous reservation rather than stacking on it', () => {
    // A step change remounts the shell, so the second value has to win
    // outright or the stack would creep up the screen step by step.
    setToastInset(53)
    setToastInset(80)
    expect(readVariable()).toBe(`${80 + TOAST_INSET_GAP_PX}px`)
  })

  it('releases the reservation, restoring the fallback', () => {
    setToastInset(53)
    setToastInset(null)
    expect(readVariable()).toBe('')
  })

  it('accepts a zero height, which is a real measurement', () => {
    setToastInset(0)
    expect(readVariable()).toBe(`${TOAST_INSET_GAP_PX}px`)
  })

  it('ignores a measurement that would push the stack off-screen, and says so', () => {
    // NaN is what an element measured before layout settles can produce, and
    // writing it would silently cost the user every toast that follows.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setToastInset(42)
    setToastInset(Number.NaN)
    setToastInset(-10)
    setToastInset(Number.POSITIVE_INFINITY)

    expect(readVariable()).toBe(`${42 + TOAST_INSET_GAP_PX}px`)
    expect(warn).toHaveBeenCalledTimes(3)
  })
})

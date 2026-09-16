import { describe, it, expect, beforeEach } from 'vitest'
import { busySessionIds, isSessionBusy, markSessionBusy, markSessionIdle } from './sessionActivity'

// The module holds its Set at module scope, so each test clears whatever
// the previous one left behind rather than relying on import order.
beforeEach(() => {
  for (const id of busySessionIds()) markSessionIdle(id)
})

describe('sessionActivity', () => {
  it('reports a session idle until it is marked busy', () => {
    expect(isSessionBusy('s1')).toBe(false)
    markSessionBusy('s1')
    expect(isSessionBusy('s1')).toBe(true)
  })

  it('marks a session idle again', () => {
    markSessionBusy('s1')
    markSessionIdle('s1')
    expect(isSessionBusy('s1')).toBe(false)
  })

  it('is idempotent: marking busy twice or idle twice is harmless', () => {
    markSessionBusy('s1')
    markSessionBusy('s1')
    expect(busySessionIds()).toEqual(['s1'])
    markSessionIdle('s1')
    markSessionIdle('s1')
    expect(busySessionIds()).toEqual([])
  })

  it('tracks multiple sessions independently', () => {
    markSessionBusy('s1')
    markSessionBusy('s2')
    expect(isSessionBusy('s1')).toBe(true)
    expect(isSessionBusy('s2')).toBe(true)
    markSessionIdle('s1')
    expect(isSessionBusy('s1')).toBe(false)
    expect(isSessionBusy('s2')).toBe(true)
  })

  it('lists every currently busy session id', () => {
    markSessionBusy('s1')
    markSessionBusy('s2')
    expect(new Set(busySessionIds())).toEqual(new Set(['s1', 's2']))
  })

  it('marking an unknown session idle is a no-op, not an error', () => {
    expect(() => markSessionIdle('nope')).not.toThrow()
    expect(isSessionBusy('nope')).toBe(false)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hasUnsavedChanges, syncUnsavedChangesToMain, useUnsavedChangesStore } from './unsavedChangesStore'

beforeEach(() => {
  useUnsavedChangesStore.setState({ sources: {} })
})

describe('unsavedChangesStore', () => {
  it('tracks each source separately and aggregates them', () => {
    const { setSource } = useUnsavedChangesStore.getState()
    setSource('variant', true)
    setSource('master', true)
    expect(hasUnsavedChanges(useUnsavedChangesStore.getState().sources)).toBe(true)
    setSource('variant', false)
    expect(hasUnsavedChanges(useUnsavedChangesStore.getState().sources)).toBe(true)
    setSource('master', false)
    expect(hasUnsavedChanges(useUnsavedChangesStore.getState().sources)).toBe(false)
  })

  it('does not produce a new state object for a no-op', () => {
    const { setSource } = useUnsavedChangesStore.getState()
    const before = useUnsavedChangesStore.getState().sources
    setSource('variant', false)
    expect(useUnsavedChangesStore.getState().sources).toBe(before)
  })

  it('reports to main only when the aggregate flips', () => {
    const report = vi.fn()
    const stop = syncUnsavedChangesToMain(report)
    expect(report).toHaveBeenCalledWith(false)
    const { setSource } = useUnsavedChangesStore.getState()
    setSource('variant', true)
    setSource('master', true)
    expect(report).toHaveBeenCalledTimes(2)
    expect(report).toHaveBeenLastCalledWith(true)
    setSource('variant', false)
    expect(report).toHaveBeenCalledTimes(2)
    setSource('master', false)
    expect(report).toHaveBeenLastCalledWith(false)
    stop()
    setSource('variant', true)
    expect(report).toHaveBeenCalledTimes(3)
  })
})

import { useEffect } from 'react'
import { create } from 'zustand'

/*
 * Which editors currently hold unsaved work, so closing the window can ask
 * first. Each editor registers under its own key (a resume draft, the new
 * variant being written) and the main process only ever hears the
 * aggregate: `window.on('close')` lives there, and it needs a yes/no, not a
 * list. `useUnsavedSource` is what an editor mounts; it clears its key on
 * unmount so a screen that goes away cannot leave a stale claim behind.
 */

interface UnsavedChangesState {
  sources: Record<string, true>
  setSource: (key: string, dirty: boolean) => void
}

export const useUnsavedChangesStore = create<UnsavedChangesState>((set) => ({
  sources: {},
  setSource: (key, dirty) =>
    set((state) => {
      if (dirty === (key in state.sources)) return state
      const sources = { ...state.sources }
      if (dirty) sources[key] = true
      else delete sources[key]
      return { sources }
    })
}))

export function hasUnsavedChanges(sources: Record<string, true>): boolean {
  return Object.keys(sources).length > 0
}

/** Registers `dirty` under `key` for as long as the caller is mounted. */
export function useUnsavedSource(key: string, dirty: boolean): void {
  const setSource = useUnsavedChangesStore((s) => s.setSource)
  useEffect(() => {
    setSource(key, dirty)
    return () => setSource(key, false)
  }, [key, dirty, setSource])
}

/**
 * Mirrors the aggregate to the main process whenever it flips. Returns the
 * unsubscribe, so the shell can hold it for its lifetime.
 */
export function syncUnsavedChangesToMain(report: (value: boolean) => void): () => void {
  let last = hasUnsavedChanges(useUnsavedChangesStore.getState().sources)
  report(last)
  return useUnsavedChangesStore.subscribe((state) => {
    const next = hasUnsavedChanges(state.sources)
    if (next === last) return
    last = next
    report(next)
  })
}

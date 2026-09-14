import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clampDetailsWidth,
  clampListWidth,
  readStoredResumesLayout,
  writeStoredResumesLayout,
  type ResumesLayout
} from './resumesLayout'

/*
 * The React half of `resumesLayout.ts`: state plus debounced persistence,
 * the same shape as `workspace/useWorkspaceLayout.ts`. Owned by
 * `ResumesPage` and handed to both document tabs so the details column is
 * one width wherever it appears.
 */

const PERSIST_DEBOUNCE_MS = 200

export interface ResumesLayoutController {
  layout: ResumesLayout
  /** @param available Width of the whole row; @param other the opposite side column's width. */
  setListWidth: (width: number, available?: number, other?: number) => void
  setDetailsWidth: (width: number, available?: number, other?: number) => void
}

export function useResumesLayout(): ResumesLayoutController {
  const [layout, setLayout] = useState<ResumesLayout>(() => readStoredResumesLayout())
  const layoutRef = useRef(layout)
  useEffect(() => {
    layoutRef.current = layout
  }, [layout])

  useEffect(() => {
    const timer = setTimeout(() => writeStoredResumesLayout(layout), PERSIST_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [layout])

  useEffect(() => {
    const flush = (): void => writeStoredResumesLayout(layoutRef.current)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      flush()
    }
  }, [])

  const setListWidth = useCallback((width: number, available?: number, other?: number) => {
    setLayout((current) => ({ ...current, listWidth: clampListWidth(width, available, other) }))
  }, [])
  const setDetailsWidth = useCallback((width: number, available?: number, other?: number) => {
    setLayout((current) => ({ ...current, detailsWidth: clampDetailsWidth(width, available, other) }))
  }, [])

  return { layout, setListWidth, setDetailsWidth }
}

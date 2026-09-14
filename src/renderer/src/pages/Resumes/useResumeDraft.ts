import { useCallback, useState } from 'react'
import type { ResumeContent } from '@shared/types/resume'
import { isSameContent } from '../../components/resume/resumeEditorLogic'

/*
 * The editable copy of a resume (master or variant) the page holds while the
 * user is in Edit mode. Derived, not synchronised: with no edits the draft
 * *is* the stored source, so an agent write or a refetch shows up on the next
 * render; once the user has edited, the edits are kept until Save or Discard,
 * since losing ten minutes of typing to a background refresh is worse than
 * showing a draft that is one save behind.
 *
 * Edits belong to one resume: they are stamped with the `identity` they were
 * made against (a variant's id, or "master"), and a different identity gets
 * the stored source, not somebody else's typing. Without that, selecting
 * variant B while A had unsaved edits showed A's text over B and a Save
 * would have written it into B. `sourceKey` is finer than the identity (the
 * caller's updatedAt is in it) and only drives `version`, which changes
 * whenever the stored source changes or the draft is reset, so the editor
 * (whose bullet textareas are uncontrolled) can remount and pick up the new
 * text.
 */

export interface ResumeDraftEdits {
  identity: string
  content: ResumeContent
}

export interface ResumeDraft {
  draft: ResumeContent | null
  dirty: boolean
  version: string
  setDraft: (next: ResumeContent) => void
  /** Drops the edits; the draft is the stored source again. */
  reset: () => void
}

/** The draft shown for `identity`: its own edits if there are any, otherwise the stored source. */
export function resolveResumeDraft(
  edits: ResumeDraftEdits | null,
  source: ResumeContent | null,
  identity: string
): { draft: ResumeContent | null; dirty: boolean } {
  if (edits && edits.identity === identity) return { draft: edits.content, dirty: true }
  return { draft: source, dirty: false }
}

/** What an edit becomes: nothing when it lands back on the stored source, otherwise edits stamped with the identity. */
export function nextResumeDraftEdits(next: ResumeContent, source: ResumeContent | null, identity: string): ResumeDraftEdits | null {
  return source !== null && isSameContent(next, source) ? null : { identity, content: next }
}

export function useResumeDraft(source: ResumeContent | null, sourceKey: string, identity: string): ResumeDraft {
  const [edits, setEdits] = useState<ResumeDraftEdits | null>(null)
  const [resets, setResets] = useState(0)

  const setDraft = useCallback(
    (next: ResumeContent) => {
      setEdits(nextResumeDraftEdits(next, source, identity))
    },
    [source, identity]
  )

  const reset = useCallback(() => {
    setEdits(null)
    setResets((value) => value + 1)
  }, [])

  const { draft, dirty } = resolveResumeDraft(edits, source, identity)
  return {
    draft,
    dirty,
    version: `${sourceKey}:${resets}`,
    setDraft,
    reset
  }
}

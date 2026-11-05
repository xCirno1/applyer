import { CUSTOM_SYSTEM_PROMPT_MAX_LENGTH, parseCustomSystemPrompt } from '@shared/types/customSystemPrompt'

/**
 * The plain-module half of `CustomSystemPromptEditor`: what the counter
 * shows, whether the draft differs from what is saved, and which buttons are
 * live, all derived from the draft and the stored text alone so the rules
 * are testable without mounting the editor (same split as
 * `openRouterModelLogic.ts` beside `OpenRouterModelSettings`).
 *
 * The comparison and the length both use the same normalization main
 * applies on save (`parseCustomSystemPrompt`), so trailing spaces or a
 * pasted CRLF never make the draft look unsaved, and the counter never
 * disagrees with the limit main enforces.
 */
export interface CustomPromptEditorState {
  /** Length of the draft as it would be stored. */
  length: number
  max: number
  /** Characters over the limit, 0 when within it. */
  over: number
  /** The draft would store something other than what is stored now. */
  dirty: boolean
  canSave: boolean
  canDiscard: boolean
  /** There is stored text to clear. */
  canClear: boolean
}

export function customPromptEditorState(draft: string, saved: string): CustomPromptEditorState {
  const parsed = parseCustomSystemPrompt(draft)
  const normalized = parsed.ok ? parsed.value : null
  const length = parsed.ok ? parsed.value.length : (parsed.length ?? draft.length)
  const over = Math.max(0, length - CUSTOM_SYSTEM_PROMPT_MAX_LENGTH)
  const dirty = normalized === null ? true : normalized !== saved
  return {
    length,
    max: CUSTOM_SYSTEM_PROMPT_MAX_LENGTH,
    over,
    dirty,
    canSave: dirty && parsed.ok,
    canDiscard: draft !== saved,
    canClear: saved !== ''
  }
}

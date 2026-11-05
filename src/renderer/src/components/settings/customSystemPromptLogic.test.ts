import { describe, it, expect } from 'vitest'
import { customPromptEditorState } from './customSystemPromptLogic'
import { CUSTOM_SYSTEM_PROMPT_MAX_LENGTH } from '@shared/types/customSystemPrompt'

describe('customPromptEditorState', () => {
  it('is clean, unsavable and unclearable with nothing stored and nothing typed', () => {
    expect(customPromptEditorState('', '')).toEqual({
      length: 0,
      max: CUSTOM_SYSTEM_PROMPT_MAX_LENGTH,
      over: 0,
      dirty: false,
      canSave: false,
      canDiscard: false,
      canClear: false
    })
  })

  it('becomes savable and discardable once the draft differs', () => {
    const state = customPromptEditorState('Only remote roles.', '')
    expect(state.dirty).toBe(true)
    expect(state.canSave).toBe(true)
    expect(state.canDiscard).toBe(true)
    expect(state.length).toBe('Only remote roles.'.length)
  })

  it('treats whitespace and line-ending differences as unchanged, matching what main would store', () => {
    const state = customPromptEditorState('Only remote roles.  \r\n\r\n', 'Only remote roles.')
    expect(state.dirty).toBe(false)
    expect(state.canSave).toBe(false)
    // The raw text still differs, so the user can throw the stray spaces away.
    expect(state.canDiscard).toBe(true)
  })

  it('lets a stored prompt be cleared, and saving an emptied draft is a real change', () => {
    expect(customPromptEditorState('Be brief.', 'Be brief.').canClear).toBe(true)
    const emptied = customPromptEditorState('   ', 'Be brief.')
    expect(emptied.dirty).toBe(true)
    expect(emptied.canSave).toBe(true)
    expect(emptied.length).toBe(0)
  })

  it('counts exactly at the limit as within it', () => {
    const state = customPromptEditorState('a'.repeat(CUSTOM_SYSTEM_PROMPT_MAX_LENGTH), '')
    expect(state.over).toBe(0)
    expect(state.canSave).toBe(true)
  })

  it('refuses to save a draft over the limit and reports by how much', () => {
    const state = customPromptEditorState('a'.repeat(CUSTOM_SYSTEM_PROMPT_MAX_LENGTH + 5), '')
    expect(state.over).toBe(5)
    expect(state.length).toBe(CUSTOM_SYSTEM_PROMPT_MAX_LENGTH + 5)
    expect(state.dirty).toBe(true)
    expect(state.canSave).toBe(false)
  })
})

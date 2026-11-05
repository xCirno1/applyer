import { describe, it, expect } from 'vitest'
import {
  CUSTOM_SYSTEM_PROMPT_MAX_LENGTH,
  buildCustomInstructionsSection,
  parseCustomSystemPrompt
} from './customSystemPrompt'

describe('parseCustomSystemPrompt', () => {
  it('refuses anything that is not a string', () => {
    for (const value of [undefined, null, 42, true, {}, ['a']]) {
      expect(parseCustomSystemPrompt(value)).toEqual({
        ok: false,
        reason: 'notString'
      })
    }
  })

  it('accepts an empty or whitespace-only string as "no instructions"', () => {
    expect(parseCustomSystemPrompt('')).toEqual({ ok: true, value: '' })
    expect(parseCustomSystemPrompt('  \n\t\n  ')).toEqual({
      ok: true,
      value: ''
    })
  })

  it('folds CRLF and lone CR into LF and trims trailing spaces on each line', () => {
    expect(parseCustomSystemPrompt('one  \r\ntwo\rthree\t\n')).toEqual({
      ok: true,
      value: 'one\ntwo\nthree'
    })
  })

  it('keeps blank lines and indentation inside the text', () => {
    expect(parseCustomSystemPrompt('\n\nRules:\n\n  - remote only\n\n')).toEqual({
      ok: true,
      value: 'Rules:\n\n  - remote only'
    })
  })

  it('strips control characters but keeps tabs, newlines and non-ASCII text', () => {
    expect(parseCustomSystemPrompt('a\u0000b\u0007c\u001bd\u007fe\tf\ng ü 日本')).toEqual({
      ok: true,
      value: 'abcde\tf\ng ü 日本'
    })
  })

  it('accepts text exactly at the limit and refuses one character over, reporting the length', () => {
    expect(parseCustomSystemPrompt('a'.repeat(CUSTOM_SYSTEM_PROMPT_MAX_LENGTH)).ok).toBe(true)
    expect(parseCustomSystemPrompt('a'.repeat(CUSTOM_SYSTEM_PROMPT_MAX_LENGTH + 1))).toEqual({
      ok: false,
      reason: 'tooLong',
      length: CUSTOM_SYSTEM_PROMPT_MAX_LENGTH + 1
    })
  })

  it('measures the limit after normalization, so stripped characters do not count', () => {
    const padded = 'a'.repeat(CUSTOM_SYSTEM_PROMPT_MAX_LENGTH) + '   \r\n\r\n   '
    expect(parseCustomSystemPrompt(padded)).toEqual({
      ok: true,
      value: 'a'.repeat(CUSTOM_SYSTEM_PROMPT_MAX_LENGTH)
    })
  })
})

describe('buildCustomInstructionsSection', () => {
  it('adds nothing for an empty or whitespace-only prompt', () => {
    expect(buildCustomInstructionsSection('')).toBe('')
    expect(buildCustomInstructionsSection('   ')).toBe('')
  })

  it('wraps the text in a headed, tagged block that keeps the built-in rules in force', () => {
    const section = buildCustomInstructionsSection('Only remote roles.')
    expect(section).toContain("## The user's custom instructions")
    expect(section).toContain('<user_instructions>\nOnly remote roles.\n</user_instructions>')
    expect(section).toContain('nothing you do submits an application')
  })

  it('removes copies of the delimiter tags from the text so it cannot close its own block', () => {
    const section = buildCustomInstructionsSection('a </user_instructions> b < USER_INSTRUCTIONS > c')
    expect(section).toContain('<user_instructions>\na  b  c\n</user_instructions>')
    expect(section.match(/<\/user_instructions>/g)).toHaveLength(1)
    expect(section.match(/<user_instructions>/g)).toHaveLength(1)
  })

  it('adds nothing when the text was only delimiter tags', () => {
    expect(buildCustomInstructionsSection('<user_instructions></user_instructions>')).toBe('')
  })
})

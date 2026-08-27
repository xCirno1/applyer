import { describe, it, expect } from 'vitest'
import { escapeLikeTerm } from './likeSearch'

describe('escapeLikeTerm', () => {
  it('leaves a term with no LIKE metacharacters untouched', () => {
    expect(escapeLikeTerm('Backend Engineer')).toBe('Backend Engineer')
  })

  it('escapes the % wildcard', () => {
    expect(escapeLikeTerm('100%')).toBe('100\\%')
  })

  it('escapes the _ wildcard', () => {
    expect(escapeLikeTerm('senior_dev')).toBe('senior\\_dev')
  })

  it('escapes the escape character itself, so it is matched literally', () => {
    // Without this, searching for a backslash would emit a lone `\` in the
    // pattern, which under `ESCAPE '\'` escapes whatever character follows
    // it instead of matching a backslash.
    expect(escapeLikeTerm('a\\b')).toBe('a\\\\b')
  })

  it('escapes every occurrence, not just the first', () => {
    expect(escapeLikeTerm('%_%')).toBe('\\%\\_\\%')
  })
})

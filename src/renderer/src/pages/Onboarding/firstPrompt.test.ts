import { describe, it, expect, vi } from 'vitest'
import { chooseFirstPrompt, usableRole } from './firstPrompt'

describe('usableRole', () => {
  it('picks the first role that can be dropped into a sentence', () => {
    expect(usableRole(['Frontend Engineer', 'Designer'])).toBe('Frontend Engineer')
  })

  it('collapses the whitespace a comma-separated field leaves behind', () => {
    expect(usableRole(['  Staff   Backend\nEngineer '])).toBe('Staff Backend Engineer')
  })

  it('skips entries that would not read as a role', () => {
    expect(usableRole(['', '   ', 'Data Scientist'])).toBe('Data Scientist')
    expect(usableRole(['x'.repeat(200), 'SRE'])).toBe('SRE')
    expect(usableRole([])).toBeNull()
  })

  it('ignores non-string entries rather than interpolating them', () => {
    // The list is persisted user input, so a bad row is a real possibility
    // (an import, an agent's update_profile call) and must not render as
    // "find me [object Object] jobs".
    expect(usableRole([null as unknown as string, 42 as unknown as string, 'Analyst'])).toBe('Analyst')
  })

  it('reports a roles value that is not a list at all, and falls back', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(usableRole('Engineer' as unknown as string[])).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('stays quiet about an absent list, which is not a fault', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(usableRole(undefined)).toBeNull()
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('chooseFirstPrompt', () => {
  it('offers to fill the profile from the resume when the profile was skipped', () => {
    expect(
      chooseFirstPrompt({ profileComplete: false, hasResume: true, desiredRoles: ['Engineer'] })
    ).toEqual({ kind: 'fromResume' })
  })

  it('goes straight to searching once the profile is filled in', () => {
    expect(chooseFirstPrompt({ profileComplete: true, hasResume: true, desiredRoles: ['Engineer'] })).toEqual({
      kind: 'roleSearch',
      role: 'Engineer'
    })
  })

  it('names no role when there is no usable one', () => {
    expect(chooseFirstPrompt({ profileComplete: true, hasResume: true, desiredRoles: [] })).toEqual({
      kind: 'genericSearch'
    })
    expect(chooseFirstPrompt({ profileComplete: true, hasResume: true, desiredRoles: ['   '] })).toEqual({
      kind: 'genericSearch'
    })
  })

  it('does not suggest reading a resume that was never uploaded', () => {
    expect(chooseFirstPrompt({ profileComplete: false, hasResume: false, desiredRoles: [] })).toEqual({
      kind: 'genericSearch'
    })
  })
})

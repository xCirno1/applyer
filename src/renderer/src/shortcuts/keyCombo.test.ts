// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { isMacPlatform, comboIdFromEvent, comboIdToLabel } from './keyCombo'

function stubPlatform(platform: string): void {
  vi.stubGlobal('navigator', { platform, userAgent: platform })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function keydown(init: KeyboardEventInit & { code?: string }): KeyboardEvent {
  return new KeyboardEvent('keydown', init)
}

describe('isMacPlatform', () => {
  it('is true when navigator.platform mentions Mac', () => {
    stubPlatform('MacIntel')
    expect(isMacPlatform()).toBe(true)
  })

  it('is false on other platforms', () => {
    stubPlatform('Win32')
    expect(isMacPlatform()).toBe(false)
    stubPlatform('Linux x86_64')
    expect(isMacPlatform()).toBe(false)
  })
})

describe('comboIdFromEvent', () => {
  it('returns null when the mod key is not held', () => {
    stubPlatform('Linux')
    expect(comboIdFromEvent(keydown({ key: 't', code: 'KeyT', ctrlKey: false }))).toBeNull()
  })

  it('returns null for a bare modifier keypress even with another modifier held', () => {
    stubPlatform('Linux')
    expect(comboIdFromEvent(keydown({ key: 'Control', code: 'ControlLeft', ctrlKey: true }))).toBeNull()
    expect(comboIdFromEvent(keydown({ key: 'Shift', code: 'ShiftLeft', ctrlKey: true, shiftKey: true }))).toBeNull()
  })

  it('uses ctrlKey on non-mac platforms', () => {
    stubPlatform('Linux')
    expect(comboIdFromEvent(keydown({ key: 't', code: 'KeyT', ctrlKey: true }))).toBe('mod+t')
    expect(comboIdFromEvent(keydown({ key: 't', code: 'KeyT', metaKey: true }))).toBeNull()
  })

  it('uses metaKey (Cmd) on mac, ignoring ctrlKey', () => {
    stubPlatform('MacIntel')
    expect(comboIdFromEvent(keydown({ key: 't', code: 'KeyT', metaKey: true }))).toBe('mod+t')
    expect(comboIdFromEvent(keydown({ key: 't', code: 'KeyT', ctrlKey: true }))).toBeNull()
  })

  it('includes shift and alt in the combo id, in a fixed order', () => {
    stubPlatform('Linux')
    const combo = comboIdFromEvent(keydown({ key: 't', code: 'KeyT', ctrlKey: true, shiftKey: true, altKey: true }))
    expect(combo).toBe('mod+shift+alt+t')
  })

  it('derives the base key from e.code for digits and letters', () => {
    stubPlatform('Linux')
    expect(comboIdFromEvent(keydown({ key: '1', code: 'Digit1', ctrlKey: true }))).toBe('mod+1')
    expect(comboIdFromEvent(keydown({ key: 'b', code: 'KeyB', ctrlKey: true }))).toBe('mod+b')
  })

  it('derives the base key from e.code for punctuation, unaffected by Shift-shifted e.key', () => {
    stubPlatform('Linux')
    // Shift+[ reports e.key === "{" — the combo id must still read "[" from e.code.
    const combo = comboIdFromEvent(keydown({ key: '{', code: 'BracketLeft', ctrlKey: true, shiftKey: true }))
    expect(combo).toBe('mod+shift+[')
  })

  it('falls back to e.key.toLowerCase() for keys with no special code mapping', () => {
    stubPlatform('Linux')
    expect(comboIdFromEvent(keydown({ key: 'Enter', code: 'Enter', ctrlKey: true }))).toBe('mod+enter')
  })

  it('allows a bare function key with no mod held', () => {
    stubPlatform('Linux')
    expect(comboIdFromEvent(keydown({ key: 'F2', code: 'F2', ctrlKey: false }))).toBe('f2')
    expect(comboIdFromEvent(keydown({ key: 'F12', code: 'F12', ctrlKey: false }))).toBe('f12')
  })

  it('still layers mod/shift/alt onto a function key when they are held', () => {
    stubPlatform('Linux')
    expect(comboIdFromEvent(keydown({ key: 'F2', code: 'F2', ctrlKey: true, shiftKey: true }))).toBe('mod+shift+f2')
  })

  it('rejects a non-function key with no mod held, even if it looks similar', () => {
    stubPlatform('Linux')
    expect(comboIdFromEvent(keydown({ key: 'f', code: 'KeyF', ctrlKey: false }))).toBeNull()
  })
})

describe('comboIdToLabel', () => {
  it('renders mac symbols for mod/shift/alt', () => {
    stubPlatform('MacIntel')
    expect(comboIdToLabel('mod+shift+t')).toBe('⌘⇧T')
    expect(comboIdToLabel('mod+alt+b')).toBe('⌘⌥B')
  })

  it('renders textual Ctrl+Shift+ form on non-mac', () => {
    stubPlatform('Linux')
    expect(comboIdToLabel('mod+shift+t')).toBe('Ctrl+Shift+T')
  })

  it('uses named labels for special keys (space, arrows, escape)', () => {
    stubPlatform('Linux')
    expect(comboIdToLabel('mod+ ')).toBe('Ctrl+Space')
    expect(comboIdToLabel('mod+arrowup')).toBe('Ctrl+↑')
    expect(comboIdToLabel('mod+escape')).toBe('Ctrl+Esc')
  })

  it('uppercases a single-character key', () => {
    stubPlatform('Linux')
    expect(comboIdToLabel('mod+b')).toBe('Ctrl+B')
    // Backtick has no uppercase form, so it round-trips unchanged.
    expect(comboIdToLabel('mod+`')).toBe('Ctrl+`')
  })
})

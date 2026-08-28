import { describe, it, expect } from 'vitest'
import {
  matchTerminalKeyBinding,
  newlineSequence,
  readCsiParam,
  KittyKeyboardState,
  DELETE_WORD_SEQUENCE,
  NEWLINE_LEGACY_SEQUENCE,
  NEWLINE_KITTY_SEQUENCE
} from './terminalKeys'

interface KeyEventShape {
  key: string
  type?: string
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  metaKey?: boolean
}

/** The handful of fields the matcher reads, without needing a real DOM event. */
function keyEvent(shape: KeyEventShape): KeyboardEvent {
  return {
    type: 'keydown',
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...shape
  } as KeyboardEvent
}

const PC = { isMac: false, kittyKeyboardEnabled: false }
const MAC = { isMac: true, kittyKeyboardEnabled: false }

describe('matchTerminalKeyBinding', () => {
  it('binds Ctrl+Shift+C to copy and Ctrl+Shift+V to paste off macOS', () => {
    expect(matchTerminalKeyBinding(keyEvent({ key: 'C', ctrlKey: true, shiftKey: true }), PC)).toBe('copy')
    expect(matchTerminalKeyBinding(keyEvent({ key: 'V', ctrlKey: true, shiftKey: true }), PC)).toBe('paste')
  })

  it('leaves plain Ctrl+C alone, so the program inside still receives SIGINT', () => {
    expect(matchTerminalKeyBinding(keyEvent({ key: 'c', ctrlKey: true }), PC)).toBeNull()
  })

  it('leaves Ctrl+Shift+C alone once another modifier joins it', () => {
    const event = keyEvent({ key: 'C', ctrlKey: true, shiftKey: true, altKey: true })
    expect(matchTerminalKeyBinding(event, PC)).toBeNull()
  })

  it('ignores other letters held with the clipboard chord', () => {
    expect(matchTerminalKeyBinding(keyEvent({ key: 'X', ctrlKey: true, shiftKey: true }), PC)).toBeNull()
  })

  it('binds Cmd+C/Cmd+V on macOS, and not Ctrl+Shift+C', () => {
    expect(matchTerminalKeyBinding(keyEvent({ key: 'c', metaKey: true }), MAC)).toBe('copy')
    expect(matchTerminalKeyBinding(keyEvent({ key: 'v', metaKey: true }), MAC)).toBe('paste')
    expect(matchTerminalKeyBinding(keyEvent({ key: 'C', ctrlKey: true, shiftKey: true }), MAC)).toBeNull()
  })

  it('does not bind Cmd+C off macOS', () => {
    expect(matchTerminalKeyBinding(keyEvent({ key: 'c', metaKey: true }), PC)).toBeNull()
  })

  it('binds Shift+Enter to newline and leaves plain Enter to xterm', () => {
    expect(matchTerminalKeyBinding(keyEvent({ key: 'Enter', shiftKey: true }), PC)).toBe('newline')
    expect(matchTerminalKeyBinding(keyEvent({ key: 'Enter' }), PC)).toBeNull()
  })

  it('leaves Ctrl+Shift+Enter and Alt+Shift+Enter to xterm', () => {
    expect(matchTerminalKeyBinding(keyEvent({ key: 'Enter', shiftKey: true, ctrlKey: true }), PC)).toBeNull()
    expect(matchTerminalKeyBinding(keyEvent({ key: 'Enter', shiftKey: true, altKey: true }), PC)).toBeNull()
  })

  it('matches the companion keypress and keyup, not just the keydown', () => {
    // Shift+Enter's keypress carries charCode 13, which xterm would turn
    // into a second plain "\r" — the caller has to swallow it, so the
    // matcher has to keep recognising it.
    expect(matchTerminalKeyBinding(keyEvent({ key: 'Enter', shiftKey: true, type: 'keypress' }), PC)).toBe('newline')
    expect(matchTerminalKeyBinding(keyEvent({ key: 'Enter', shiftKey: true, type: 'keyup' }), PC)).toBe('newline')
  })

  it('binds Ctrl+Backspace to a word delete and leaves plain Backspace to xterm', () => {
    expect(matchTerminalKeyBinding(keyEvent({ key: 'Backspace', ctrlKey: true }), PC)).toBe('deleteWord')
    expect(matchTerminalKeyBinding(keyEvent({ key: 'Backspace' }), PC)).toBeNull()
  })

  it('leaves Alt+Backspace to xterm, which already sends the word-delete sequence itself', () => {
    expect(matchTerminalKeyBinding(keyEvent({ key: 'Backspace', altKey: true }), PC)).toBeNull()
    expect(matchTerminalKeyBinding(keyEvent({ key: 'Backspace', ctrlKey: true, altKey: true }), PC)).toBeNull()
  })

  it('leaves Ctrl+Shift+Backspace to xterm', () => {
    const event = keyEvent({ key: 'Backspace', ctrlKey: true, shiftKey: true })
    expect(matchTerminalKeyBinding(event, PC)).toBeNull()
  })

  it('binds Ctrl+Backspace on macOS too, where Cmd owns the clipboard chord', () => {
    expect(matchTerminalKeyBinding(keyEvent({ key: 'Backspace', ctrlKey: true }), MAC)).toBe('deleteWord')
  })

  it('does not throw on an event with no usable key', () => {
    expect(matchTerminalKeyBinding({ ctrlKey: true, shiftKey: true } as KeyboardEvent, PC)).toBeNull()
  })
})

describe('newlineSequence', () => {
  it('sends ESC CR when the Kitty protocol is off', () => {
    expect(newlineSequence(false)).toBe(NEWLINE_LEGACY_SEQUENCE)
    expect(newlineSequence(false)).toBe('\x1b\r')
  })

  it('sends the CSI u encoding when the program asked for the Kitty protocol', () => {
    expect(newlineSequence(true)).toBe(NEWLINE_KITTY_SEQUENCE)
    expect(newlineSequence(true)).toBe('\x1b[13;2u')
  })
})

describe('DELETE_WORD_SEQUENCE', () => {
  it('is ESC DEL, readline\'s backward-kill-word binding', () => {
    // Verified against `bind -p`: "\e\C-?" maps to backward-kill-word,
    // while the "\b" xterm sends for Ctrl+Backspace maps to
    // backward-delete-char, i.e. a single character.
    expect(DELETE_WORD_SEQUENCE).toBe('\x1b\x7f')
  })
})

describe('readCsiParam', () => {
  it('reads a plain numeric parameter', () => {
    expect(readCsiParam([5, 9], 1, 1)).toBe(9)
  })

  it('reads the first entry of a sub-parameter array', () => {
    expect(readCsiParam([[3, 4]], 0, 1)).toBe(3)
  })

  it('falls back for a missing, omitted, or negative parameter', () => {
    expect(readCsiParam([], 0, 1)).toBe(1)
    expect(readCsiParam([0], 0, 1)).toBe(1)
    expect(readCsiParam([-2], 0, 1)).toBe(1)
  })

  it('falls back for a non-numeric parameter rather than propagating NaN', () => {
    expect(readCsiParam([NaN], 0, 7)).toBe(7)
    expect(readCsiParam([[]], 0, 7)).toBe(7)
  })
})

describe('KittyKeyboardState', () => {
  it('starts disabled', () => {
    const state = new KittyKeyboardState()
    expect(state.enabled).toBe(false)
    expect(state.flags).toBe(0)
  })

  it('enables on a pushed flag set and disables again when popped', () => {
    const state = new KittyKeyboardState()
    state.push(1)
    expect(state.enabled).toBe(true)
    expect(state.flags).toBe(1)
    state.pop(1)
    expect(state.enabled).toBe(false)
  })

  it('treats a pushed zero as "protocol off" without unbalancing the stack', () => {
    const state = new KittyKeyboardState()
    state.push(1)
    state.push(0)
    expect(state.enabled).toBe(false)
    state.pop(1)
    expect(state.flags).toBe(1)
  })

  it('pops more entries than exist without going negative', () => {
    const state = new KittyKeyboardState()
    state.push(1)
    state.pop(99)
    expect(state.flags).toBe(0)
    state.pop(1)
    expect(state.flags).toBe(0)
  })

  it('caps the stack so a runaway program cannot grow it without bound', () => {
    const state = new KittyKeyboardState()
    for (let i = 0; i < 200; i++) state.push(1)
    // Every entry above the cap dropped the oldest, so the depth is bounded
    // and the newest push is still the one in effect.
    expect(state.flags).toBe(1)
    for (let i = 0; i < 32; i++) state.pop(1)
    expect(state.flags).toBe(0)
  })

  it('replaces, sets, and clears flag bits by mode', () => {
    const state = new KittyKeyboardState()
    state.set(0b101, 1)
    expect(state.flags).toBe(0b101)
    state.set(0b010, 2)
    expect(state.flags).toBe(0b111)
    state.set(0b100, 3)
    expect(state.flags).toBe(0b011)
    state.set(0, 1)
    expect(state.enabled).toBe(false)
  })

  it('applies a set to the top of the stack, leaving what is under it intact', () => {
    const state = new KittyKeyboardState()
    state.push(0b001)
    state.push(0b010)
    state.set(0b100, 1)
    expect(state.flags).toBe(0b100)
    state.pop(1)
    expect(state.flags).toBe(0b001)
  })

  it('masks off undefined flag bits and ignores nonsense values', () => {
    const state = new KittyKeyboardState()
    state.push(0xff)
    expect(state.flags).toBe(0b11111)
    state.push(NaN)
    expect(state.flags).toBe(0)
  })

  it('clears everything on reset', () => {
    const state = new KittyKeyboardState()
    state.push(1)
    state.push(2)
    state.reset()
    expect(state.enabled).toBe(false)
    state.pop(1)
    expect(state.flags).toBe(0)
  })
})

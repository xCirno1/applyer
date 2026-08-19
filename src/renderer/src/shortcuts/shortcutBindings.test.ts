// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  SHORTCUTS_STORAGE_KEY,
  parseShortcutOverrides,
  readStoredShortcutOverrides,
  writeStoredShortcutOverrides,
  effectiveCombo
} from './shortcutBindings'
import { COMMANDS } from './commands'

beforeEach(() => {
  window.localStorage.clear()
})

describe('parseShortcutOverrides', () => {
  it('returns {} for non-object input', () => {
    expect(parseShortcutOverrides(null)).toEqual({})
    expect(parseShortcutOverrides(undefined)).toEqual({})
    expect(parseShortcutOverrides('a string')).toEqual({})
    expect(parseShortcutOverrides([1, 2, 3])).toEqual({})
  })

  it('keeps a valid string override and a null (explicitly unbound) override', () => {
    const result = parseShortcutOverrides({ 'terminal.new': 'mod+k', 'terminal.close': null })
    expect(result).toEqual({ 'terminal.new': 'mod+k', 'terminal.close': null })
  })

  it('drops unknown command ids', () => {
    expect(parseShortcutOverrides({ 'not.a.real.command': 'mod+x' })).toEqual({})
  })

  it('drops non-string, non-null values', () => {
    expect(parseShortcutOverrides({ 'terminal.new': 42 })).toEqual({})
    expect(parseShortcutOverrides({ 'terminal.new': { nested: true } })).toEqual({})
  })

  it('drops blank/whitespace-only string overrides', () => {
    expect(parseShortcutOverrides({ 'terminal.new': '   ' })).toEqual({})
  })
})

describe('readStoredShortcutOverrides / writeStoredShortcutOverrides', () => {
  it('round-trips through localStorage', () => {
    writeStoredShortcutOverrides({ 'terminal.new': 'mod+k' })
    expect(readStoredShortcutOverrides()).toEqual({ 'terminal.new': 'mod+k' })
  })

  it('returns {} when nothing is stored', () => {
    expect(readStoredShortcutOverrides()).toEqual({})
  })

  it('returns {} for malformed JSON rather than throwing', () => {
    window.localStorage.setItem(SHORTCUTS_STORAGE_KEY, '{not valid json')
    expect(readStoredShortcutOverrides()).toEqual({})
  })
})

describe('effectiveCombo', () => {
  it('falls back to the command default when no override exists', () => {
    expect(effectiveCombo('terminal.new', {})).toBe(COMMANDS['terminal.new'].defaultCombo)
  })

  it('uses an override string when present', () => {
    expect(effectiveCombo('terminal.new', { 'terminal.new': 'mod+k' })).toBe('mod+k')
  })

  it('returns null when explicitly unbound, even though a default exists', () => {
    expect(effectiveCombo('terminal.new', { 'terminal.new': null })).toBeNull()
  })
})

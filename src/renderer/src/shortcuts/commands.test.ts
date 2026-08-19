import { describe, it, expect } from 'vitest'
import { COMMANDS, COMMAND_LIST, COMMAND_CATEGORIES } from './commands'

describe('COMMANDS / COMMAND_LIST', () => {
  it('keeps COMMAND_LIST in sync with the COMMANDS map', () => {
    expect(COMMAND_LIST).toHaveLength(Object.keys(COMMANDS).length)
    expect(COMMAND_LIST.map((c) => c.id).sort()).toEqual(Object.keys(COMMANDS).sort())
  })

  it('gives every command a matching id key and a non-empty label', () => {
    for (const [key, def] of Object.entries(COMMANDS)) {
      expect(def.id).toBe(key)
      expect(def.label.length).toBeGreaterThan(0)
    }
  })

  it('has no duplicate default key combos across commands', () => {
    const combos = COMMAND_LIST.map((c) => c.defaultCombo).filter((c): c is string => c !== null)
    expect(new Set(combos).size).toBe(combos.length)
  })

  it('every default combo requires the mod key, per the app-wide convention', () => {
    for (const def of COMMAND_LIST) {
      if (def.defaultCombo) expect(def.defaultCombo.startsWith('mod+')).toBe(true)
    }
  })

  it('every command\'s category is one of the declared COMMAND_CATEGORIES', () => {
    for (const def of COMMAND_LIST) {
      expect(COMMAND_CATEGORIES).toContain(def.category)
    }
  })
})

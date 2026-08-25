import { describe, it, expect } from 'vitest'
import { COMMANDS, COMMAND_LIST, COMMAND_CATEGORIES } from './commands'
import workspaceEn from '../i18n/locales/en/workspace.json'

describe('COMMANDS / COMMAND_LIST', () => {
  it('keeps COMMAND_LIST in sync with the COMMANDS map', () => {
    expect(COMMAND_LIST).toHaveLength(Object.keys(COMMANDS).length)
    expect(COMMAND_LIST.map((c) => c.id).sort()).toEqual(Object.keys(COMMANDS).sort())
  })

  it('gives every command a matching id key', () => {
    for (const [key, def] of Object.entries(COMMANDS)) {
      expect(def.id).toBe(key)
    }
  })

  it('has an English label for every command', () => {
    // Labels live in the i18n catalog rather than on the definition, so this
    // is what catches a command added without a corresponding string.
    for (const id of Object.keys(COMMANDS)) {
      const label = (workspaceEn.commands as Record<string, unknown>)[id]
      expect(label, `missing workspace.commands.${id}`).toBeTruthy()
    }
  })

  it('has no duplicate default key combos across commands', () => {
    const combos = COMMAND_LIST.map((c) => c.defaultCombo).filter((c): c is string => c !== null)
    expect(new Set(combos).size).toBe(combos.length)
  })

  it('every default combo requires the mod key, except bare function keys', () => {
    const FUNCTION_KEY_ONLY = /^f([1-9]|1[0-9]|2[0-4])$/
    for (const def of COMMAND_LIST) {
      if (!def.defaultCombo) continue
      const requiresMod = def.defaultCombo.startsWith('mod+') || FUNCTION_KEY_ONLY.test(def.defaultCombo)
      expect(requiresMod).toBe(true)
    }
  })

  it('every command\'s category is one of the declared COMMAND_CATEGORIES', () => {
    for (const def of COMMAND_LIST) {
      expect(COMMAND_CATEGORIES).toContain(def.category)
    }
  })
})

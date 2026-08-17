// Persisted user overrides for command key bindings. Like theme/theme.ts and
// workspace/workspaceLayout.ts, this is a per-browser preference that lives
// in localStorage rather than app/DB state, kept as a plain module so the
// parsing/merge rules are exercisable without a DOM.

import { COMMANDS, type CommandId } from './commands'

export const SHORTCUTS_STORAGE_KEY = 'applyer:shortcuts:v1'

/**
 * Absent key = use the command's default binding. `null` = user explicitly
 * unbound it. A string = user-chosen combo id overriding the default.
 */
export type ShortcutOverrides = Partial<Record<CommandId, string | null>>

function isCommandId(value: string): value is CommandId {
  return Object.prototype.hasOwnProperty.call(COMMANDS, value)
}

/**
 * Rebuild overrides from whatever was in storage — every entry falls back
 * independently (unknown command ids are dropped, non-string/non-null
 * values are dropped) since this is user-writable storage and never fully
 * trusted.
 */
export function parseShortcutOverrides(raw: unknown): ShortcutOverrides {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const value = raw as Record<string, unknown>
  const result: ShortcutOverrides = {}
  for (const [key, val] of Object.entries(value)) {
    if (!isCommandId(key)) continue
    if (val === null) {
      result[key] = null
    } else if (typeof val === 'string' && val.trim().length > 0) {
      result[key] = val
    }
  }
  return result
}

export function readStoredShortcutOverrides(): ShortcutOverrides {
  try {
    const raw = window.localStorage.getItem(SHORTCUTS_STORAGE_KEY)
    if (!raw) return {}
    return parseShortcutOverrides(JSON.parse(raw))
  } catch {
    return {}
  }
}

export function writeStoredShortcutOverrides(overrides: ShortcutOverrides): void {
  try {
    window.localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(overrides))
  } catch {
    // Disabled storage/quota — bindings still apply for this session.
  }
}

export function effectiveCombo(commandId: CommandId, overrides: ShortcutOverrides): string | null {
  if (commandId in overrides) return overrides[commandId] ?? null
  return COMMANDS[commandId].defaultCombo
}

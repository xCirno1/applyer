// Canonical list of app-wide keyboard-shortcut-able actions. This module
// only declares what a command IS (id/category/default binding) — it has no
// idea how to actually run one; whichever component owns that behavior
// registers a handler for it at runtime via `useShortcutHandler` (see
// providers/ShortcutsContext.ts).
//
// Display labels deliberately live in the `workspace` i18n namespace under
// `commands.<id>`, not here: this module is imported by non-React code and
// has no access to the active locale. Use `commandLabelKey()` below to build
// the key to pass to `t()`.

export interface CommandDef {
  id: string
  category: 'Terminal' | 'View' | 'Navigation'
  /** Canonical combo id (see shortcuts/keyCombo.ts), or null for "unbound by default". */
  defaultCombo: string | null
}

export const COMMANDS = {
  'terminal.new': {
    id: 'terminal.new',
    category: 'Terminal',
    defaultCombo: 'mod+shift+t'
  },
  'terminal.close': {
    id: 'terminal.close',
    category: 'Terminal',
    defaultCombo: 'mod+shift+w'
  },
  'terminal.nextTab': {
    id: 'terminal.nextTab',
    category: 'Terminal',
    defaultCombo: 'mod+shift+]'
  },
  'terminal.prevTab': {
    id: 'terminal.prevTab',
    category: 'Terminal',
    defaultCombo: 'mod+shift+['
  },
  'terminal.rename': {
    id: 'terminal.rename',
    category: 'Terminal',
    defaultCombo: 'f2'
  },
  'terminal.search': {
    id: 'terminal.search',
    category: 'Terminal',
    defaultCombo: 'mod+f'
  },
  'view.toggleOverview': {
    id: 'view.toggleOverview',
    category: 'View',
    defaultCombo: 'mod+b'
  },
  'view.toggleConsole': {
    id: 'view.toggleConsole',
    category: 'View',
    defaultCombo: 'mod+`'
  },
  'dock.showTerminal': {
    id: 'dock.showTerminal',
    category: 'View',
    defaultCombo: 'mod+1'
  },
  'dock.showLogs': {
    id: 'dock.showLogs',
    category: 'View',
    defaultCombo: 'mod+2'
  },
  'app.toggleSettings': {
    id: 'app.toggleSettings',
    category: 'Navigation',
    defaultCombo: 'mod+,'
  }
} as const satisfies Record<string, CommandDef>

export type CommandId = keyof typeof COMMANDS

export const COMMAND_LIST: CommandDef[] = Object.values(COMMANDS)

export const COMMAND_CATEGORIES = ['Terminal', 'View', 'Navigation'] as const

export type CommandCategory = (typeof COMMAND_CATEGORIES)[number]

/**
 * The i18n key for a command's display label. Kept here so the
 * `commands.<id>` convention is stated once rather than rebuilt at each
 * call site.
 */
export function commandLabelKey(id: CommandId): `commands.${CommandId}` {
  return `commands.${id}`
}

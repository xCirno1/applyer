// Canonical list of app-wide keyboard-shortcut-able actions. This module
// only declares what a command IS (id/label/category/default binding) — it
// has no idea how to actually run one; whichever component owns that
// behavior registers a handler for it at runtime via
// `useShortcutHandler` (see providers/ShortcutsContext.ts).

export interface CommandDef {
  id: string
  label: string
  category: 'Terminal' | 'View' | 'Navigation'
  /** Canonical combo id (see shortcuts/keyCombo.ts), or null for "unbound by default". */
  defaultCombo: string | null
}

export const COMMANDS = {
  'terminal.new': {
    id: 'terminal.new',
    label: 'New terminal',
    category: 'Terminal',
    defaultCombo: 'mod+shift+t'
  },
  'terminal.close': {
    id: 'terminal.close',
    label: 'Close terminal',
    category: 'Terminal',
    defaultCombo: 'mod+shift+w'
  },
  'terminal.nextTab': {
    id: 'terminal.nextTab',
    label: 'Next terminal tab',
    category: 'Terminal',
    defaultCombo: 'mod+shift+]'
  },
  'terminal.prevTab': {
    id: 'terminal.prevTab',
    label: 'Previous terminal tab',
    category: 'Terminal',
    defaultCombo: 'mod+shift+['
  },
  'view.toggleOverview': {
    id: 'view.toggleOverview',
    label: 'Toggle overview panel',
    category: 'View',
    defaultCombo: 'mod+b'
  },
  'view.toggleConsole': {
    id: 'view.toggleConsole',
    label: 'Toggle console dock',
    category: 'View',
    defaultCombo: 'mod+`'
  },
  'dock.showTerminal': {
    id: 'dock.showTerminal',
    label: 'Show terminal tab',
    category: 'View',
    defaultCombo: 'mod+1'
  },
  'dock.showLogs': {
    id: 'dock.showLogs',
    label: 'Show activity log tab',
    category: 'View',
    defaultCombo: 'mod+2'
  },
  'app.toggleSettings': {
    id: 'app.toggleSettings',
    label: 'Open/close settings',
    category: 'Navigation',
    defaultCombo: 'mod+,'
  }
} as const satisfies Record<string, CommandDef>

export type CommandId = keyof typeof COMMANDS

export const COMMAND_LIST: CommandDef[] = Object.values(COMMANDS)

export const COMMAND_CATEGORIES = ['Terminal', 'View', 'Navigation'] as const

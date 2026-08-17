// Parsing/formatting for canonical shortcut combo ids (e.g. "mod+shift+t").
// Plain module, no React/DOM state — only reads global `navigator`/events
// passed in, so the id<->label rules are exercisable without mounting
// anything (same split as theme/theme.ts and workspace/workspaceLayout.ts).

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const source = navigator.platform || navigator.userAgent || ''
  return /mac/i.test(source)
}

const MODIFIER_ONLY_KEYS = new Set([
  'Control',
  'Meta',
  'Shift',
  'Alt',
  'AltGraph',
  'CapsLock',
  'OS',
  'Fn',
  'FnLock',
  'Hyper',
  'Super',
  'Symbol',
  'SymbolLock'
])

// `e.key` reflects the *shifted* character (Shift+[ reports "{", not "["),
// so a combo id built from it can never match a Shift-held binding recorded
// or declared with the unshifted symbol. `e.code` names the physical key
// regardless of modifiers, so we derive the base key from it for the keys
// where that distinction matters and fall back to `e.key` otherwise.
const CODE_TO_KEY: Record<string, string> = {
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/'
}

function baseKeyFromEvent(e: KeyboardEvent): string {
  const mapped = CODE_TO_KEY[e.code]
  if (mapped) return mapped
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase()
  if (/^Digit[0-9]$/.test(e.code)) return e.code.slice(5)
  return e.key.toLowerCase()
}

/**
 * Canonical combo id for a keydown event, e.g. "mod+shift+t". Every
 * bindable shortcut in this app requires the mod key (Cmd on macOS, Ctrl
 * elsewhere) — deliberately, so plain typing (including into the terminal,
 * or Chromium's native Ctrl+A/C/V/X/Z text-editing bindings) is never at
 * risk of being reinterpreted as an app shortcut. Returns null for events
 * that can't be a shortcut: no mod key held, or the event is itself a bare
 * modifier keypress.
 */
export function comboIdFromEvent(e: KeyboardEvent): string | null {
  if (MODIFIER_ONLY_KEYS.has(e.key)) return null
  const mod = isMacPlatform() ? e.metaKey : e.ctrlKey
  if (!mod) return null
  const parts = ['mod']
  if (e.shiftKey) parts.push('shift')
  if (e.altKey) parts.push('alt')
  parts.push(baseKeyFromEvent(e))
  return parts.join('+')
}

const KEY_DISPLAY: Record<string, string> = {
  ' ': 'Space',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  escape: 'Esc'
}

function displayKey(key: string): string {
  const named = KEY_DISPLAY[key]
  if (named) return named
  return key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1)
}

/** Human-readable label for a combo id, e.g. "⌘⇧T" on macOS or "Ctrl+Shift+T" elsewhere. */
export function comboIdToLabel(comboId: string): string {
  const mac = isMacPlatform()
  const parts = comboId.split('+')
  const key = parts[parts.length - 1]
  const mods = parts.slice(0, -1)
  const segments: string[] = []
  if (mods.includes('mod')) segments.push(mac ? '⌘' : 'Ctrl')
  if (mods.includes('alt')) segments.push(mac ? '⌥' : 'Alt')
  if (mods.includes('shift')) segments.push(mac ? '⇧' : 'Shift')
  segments.push(displayKey(key ?? ''))
  return mac ? segments.join('') : segments.join('+')
}

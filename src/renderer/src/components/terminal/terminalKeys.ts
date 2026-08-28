// Which keystrokes the terminal handles itself instead of forwarding to the
// pty, and how the ones it forwards are encoded. Plain module, no xterm or
// DOM state — it only reads the event handed to it, so the rules are
// exercisable without mounting a terminal (same split as
// workspace/workspaceLayout.ts vs useWorkspaceLayout.ts).

/**
 * `ESC CR`, the sequence a terminal traditionally sends for Alt+Enter and
 * the one CLI agents read as "insert a newline, don't submit". Plain Enter
 * and Shift+Enter are the same `\r` byte under the legacy keyboard
 * protocol, so without substituting something here the program inside has
 * no way to tell them apart.
 */
export const NEWLINE_LEGACY_SEQUENCE = '\x1b\r'

/**
 * `CSI 13 ; 2 u` — Shift+Enter in the Kitty keyboard protocol's `CSI u`
 * encoding (13 = Enter's codepoint, 2 = the shift modifier). Only correct
 * for a program that has asked for that protocol, since one that hasn't
 * would print it as text.
 */
export const NEWLINE_KITTY_SEQUENCE = '\x1b[13;2u'

/**
 * `ESC DEL`, which readline binds to `backward-kill-word` (its `\e\C-?`
 * entry) — the same bytes Alt+Backspace already produces.
 *
 * Unlike the newline sequences above, this is a deliberate remap rather than
 * a report of which key was pressed: xterm sends `BS` (0x08) for
 * Ctrl+Backspace, which readline binds to `backward-delete-char`, so it
 * deletes a single character exactly like plain Backspace. Terminals have no
 * word-delete-on-Ctrl+Backspace convention to honour — it comes from GUI
 * editors — so the choice is between duplicating plain Backspace and
 * spending the chord on the thing people press it for.
 */
export const DELETE_WORD_SEQUENCE = '\x1b\x7f'

/** An action the terminal performs itself rather than sending to the pty. */
export type TerminalKeyBinding = 'copy' | 'paste' | 'newline' | 'deleteWord'

export interface TerminalKeyContext {
  /** Copy/paste is Cmd-based on macOS and Ctrl+Shift-based everywhere else. */
  isMac: boolean
  /** Whether the program running inside asked for the Kitty keyboard protocol. */
  kittyKeyboardEnabled: boolean
}

/**
 * True for the modifier combination that means "the terminal's own
 * copy/paste", as opposed to the Ctrl+C the program inside should receive.
 * Every other modifier is required to be *up*, so Ctrl+Alt+Shift+C still
 * reaches the program.
 */
function isClipboardChord(event: KeyboardEvent, isMac: boolean): boolean {
  if (isMac) return event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
  return event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey
}

/**
 * The binding a key event triggers, or null to let xterm handle it normally.
 *
 * Deliberately answers for keydown, keypress and keyup alike: xterm runs its
 * custom key handler on all three, and a keydown the handler swallows still
 * leaves the browser free to fire the matching keypress. Shift+Enter's
 * keypress carries charCode 13, which xterm would turn into a second, plain
 * `\r` — so the caller has to suppress the companion events too, and needs
 * this to keep matching them.
 */
export function matchTerminalKeyBinding(
  event: KeyboardEvent,
  context: TerminalKeyContext
): TerminalKeyBinding | null {
  const key = typeof event.key === 'string' ? event.key.toLowerCase() : ''

  if (isClipboardChord(event, context.isMac)) {
    if (key === 'c') return 'copy'
    if (key === 'v') return 'paste'
    return null
  }

  if (key === 'enter' && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
    return 'newline'
  }

  // Alt+Backspace already reaches readline as a word delete on its own, so
  // only the Ctrl chord is claimed here.
  if (key === 'backspace' && event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
    return 'deleteWord'
  }

  return null
}

/** The bytes Shift+Enter sends, given whether the Kitty protocol is active. */
export function newlineSequence(kittyKeyboardEnabled: boolean): string {
  return kittyKeyboardEnabled ? NEWLINE_KITTY_SEQUENCE : NEWLINE_LEGACY_SEQUENCE
}

/**
 * Reads one numeric parameter out of an xterm CSI parameter list, which can
 * hold sub-parameter arrays and omitted (zero) slots. Never trusts the shape
 * of what the program inside sent.
 */
export function readCsiParam(params: readonly (number | number[])[], index: number, fallback: number): number {
  const raw = params[index]
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback
  // An omitted parameter arrives as 0; the Kitty protocol's defaults are the
  // same as "omitted" for every sequence we handle, so treat it as absent.
  return value === 0 ? fallback : Math.floor(value)
}

/** The five progressive-enhancement bits the Kitty keyboard protocol defines. */
const KITTY_FLAG_MASK = 0b11111

/**
 * Programs can nest keyboard modes, so the protocol models the flags as a
 * stack — 32 entries is the depth Kitty itself keeps, after which the oldest
 * entry is dropped rather than letting a runaway program grow it forever.
 */
const KITTY_STACK_LIMIT = 32

/**
 * Tracks whether the program inside has turned on the Kitty keyboard
 * protocol, so Shift+Enter can be encoded the way that program expects.
 *
 * Only the flag state is tracked, never advertised: the terminal does not
 * answer the protocol's `CSI ? u` query, so a program that asks first (the
 * common case) correctly concludes the protocol is unsupported and stays on
 * the legacy encoding. This state exists for programs that push flags
 * unconditionally, where sending `ESC CR` would be read as a standalone
 * Escape followed by Enter.
 */
export class KittyKeyboardState {
  private readonly stack: number[] = []

  /** The flags currently in effect; 0 when the protocol is off. */
  get flags(): number {
    return this.stack.length === 0 ? 0 : this.stack[this.stack.length - 1]!
  }

  get enabled(): boolean {
    return this.flags !== 0
  }

  /** `CSI > flags u` — push a new set of flags onto the stack. */
  push(flags: number): void {
    if (this.stack.length >= KITTY_STACK_LIMIT) this.stack.shift()
    this.stack.push(sanitizeKittyFlags(flags))
  }

  /** `CSI < count u` — pop `count` entries back off it. */
  pop(count: number): void {
    const times = Number.isFinite(count) && count > 0 ? Math.floor(count) : 1
    this.stack.length = Math.max(0, this.stack.length - times)
  }

  /** `CSI = flags ; mode u` — replace (1), set (2), or clear (3) flag bits. */
  set(flags: number, mode: number): void {
    const requested = sanitizeKittyFlags(flags)
    let next: number
    if (mode === 2) next = this.flags | requested
    else if (mode === 3) next = this.flags & ~requested
    else next = requested

    if (this.stack.length === 0) this.stack.push(next)
    else this.stack[this.stack.length - 1] = next
  }

  /** A full terminal reset (RIS) clears the mode, same as any other DEC state. */
  reset(): void {
    this.stack.length = 0
  }
}

function sanitizeKittyFlags(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.floor(value) & KITTY_FLAG_MASK
}

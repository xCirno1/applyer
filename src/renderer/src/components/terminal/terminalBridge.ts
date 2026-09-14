/*
 * The one door into the embedded terminal for code that does not render it.
 * The Resume Variants page and the job detail modal offer "send this to the
 * agent" buttons, and the terminal pane they need lives at the shell level
 * inside `TerminalGroup`, several components away with no shared store. A
 * module-level registry keeps the wiring to two calls: the group registers
 * whichever pane is active (and how to open one when none is), and a caller
 * hands over text.
 *
 * Text is never lost between the two: with no terminal open the text waits
 * until the group registers a pane, and the pane itself queues until its pty
 * exists (see `TerminalPane`'s handle). Only one message waits at a time; a
 * second one before the terminal appears replaces the first, which matches
 * what the user meant by clicking twice.
 *
 * No React here so the sequencing is testable without mounting xterm.
 */

export interface TerminalPasteTarget {
  paste: (text: string) => void
}

let activeTarget: TerminalPasteTarget | null = null
let openTerminal: (() => void) | null = null
let pendingText: string | null = null

/** Called by the terminal group whenever the active pane changes; `null` when none is open. */
export function registerActiveTerminal(target: TerminalPasteTarget | null): void {
  activeTarget = target
  if (target && pendingText !== null) {
    const text = pendingText
    pendingText = null
    target.paste(text)
  }
}

/** How to open a terminal when a message arrives and none exists; `null` while no group is mounted. */
export function registerTerminalOpener(open: (() => void) | null): void {
  openTerminal = open
}

/**
 * Types `text` into the active terminal, opening one first if needed.
 * Returns false when there is no terminal and nothing can open one (no
 * group mounted), so the caller can tell the user instead of pretending.
 */
export function pasteIntoTerminal(text: string): boolean {
  if (activeTarget) {
    activeTarget.paste(text)
    return true
  }
  if (!openTerminal) return false
  pendingText = text
  openTerminal()
  return true
}

/** Test hook: forget every registration and any waiting text. */
export function resetTerminalBridge(): void {
  activeTarget = null
  openTerminal = null
  pendingText = null
}

/*
 * The chat panel's twin of `terminal/terminalBridge.ts` - the one door into
 * the composer for code that never renders it. In OpenRouter mode,
 * "send this to the agent" (`TailorPromptBlock`, the job detail modal,
 * `ChatWelcome`'s starters) has to reach `ChatComposer` instead of the
 * terminal, and that composer lives at the shell level inside `ChatPanel`,
 * several components away with no shared store.
 *
 * Same contract as the terminal bridge, deliberately: the panel registers
 * whichever composer handle is mounted (there is always at most one - the
 * panel keeps a single `ChatComposer` for the active session, unlike
 * `TerminalGroup`'s one pane per tab), and a caller hands over text. Text
 * waits here until a composer exists; only the latest wins if a second
 * "send to agent" click arrives before one does, matching what the user
 * meant by clicking twice.
 *
 * No React here so the sequencing is testable without mounting anything,
 * same reasoning as the terminal bridge.
 */

export interface ChatComposerTarget {
  insertText: (text: string) => void
}

let activeComposer: ChatComposerTarget | null = null
let openChat: (() => void) | null = null
let pendingText: string | null = null

/** Called by `ChatComposer` whenever it mounts/unmounts. */
export function registerChatComposer(target: ChatComposerTarget | null): void {
  activeComposer = target
  if (target && pendingText !== null) {
    const text = pendingText
    pendingText = null
    target.insertText(text)
  }
}

/** How to make the chat panel visible when a message arrives and no composer is mounted yet; `null` while no panel is mounted. */
export function registerChatOpener(open: (() => void) | null): void {
  openChat = open
}

/**
 * Inserts `text` into the active chat composer, opening the panel first if
 * needed. Returns false when there is no composer and nothing can open one
 * (no panel mounted, or OpenRouter not connected so the composer isn't
 * rendered), so the caller can tell the user instead of pretending the
 * text went anywhere.
 */
export function insertIntoChat(text: string): boolean {
  if (activeComposer) {
    activeComposer.insertText(text)
    return true
  }
  if (!openChat) return false
  pendingText = text
  openChat()
  return true
}

/** Test hook: forget every registration and any waiting text. */
export function resetChatBridge(): void {
  activeComposer = null
  openChat = null
  pendingText = null
}

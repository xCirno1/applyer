import { createContext, useContext } from 'react'

/*
 * "Send this to the agent" from anywhere in the shell - the agent input,
 * not necessarily the terminal: in `cli` mode that's the embedded terminal
 * (`terminal/terminalBridge`), in `openrouter` mode it's the chat composer
 * (`chat/chatBridge`), and only `MainShell` knows which mode is active.
 * Either way sending means two things the caller cannot do on its own:
 * reveal whichever surface is driving job automation right now (the dock's
 * Terminal tab, or the chat panel on the right) and hand over the text.
 * `MainShell` owns both, hence a context rather than a bare import of
 * either bridge. `null` outside the shell (onboarding, storage recovery) so the
 * buttons that need it can stay hidden there. Names kept as `Terminal…`/
 * `SendToTerminal` rather than renamed for the mode split, to avoid
 * unrelated churn across every caller.
 */
export type SendToTerminal = (text: string) => void

export const TerminalInputContext = createContext<SendToTerminal | null>(null)

export function useSendToTerminal(): SendToTerminal | null {
  return useContext(TerminalInputContext)
}

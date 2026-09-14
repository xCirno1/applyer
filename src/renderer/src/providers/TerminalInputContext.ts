import { createContext, useContext } from 'react'

/*
 * "Send this to the agent" from anywhere in the shell. The terminal is one
 * instance in the shell-level dock, so sending means three things the
 * caller cannot do on its own: show the dock on the current screen, switch
 * it to the Terminal tab, and type the text (`terminal/terminalBridge`).
 * `MainShell` owns the first two, hence a context rather than a bare import
 * of the bridge. `null` outside the shell (onboarding, storage recovery)
 * so the buttons that need it can stay hidden there.
 */
export type SendToTerminal = (text: string) => void

export const TerminalInputContext = createContext<SendToTerminal | null>(null)

export function useSendToTerminal(): SendToTerminal | null {
  return useContext(TerminalInputContext)
}

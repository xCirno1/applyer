import { createContext, useContext } from 'react'
import type { SectionId } from '../pages/Settings/SettingsPage'

/*
 * "Open this Settings section" from anywhere in the shell. Settings is a
 * separate screen that `MainShell` swaps in for the whole window, so a
 * panel deep in a rail screen (the board's filter strip pointing at the
 * search country, say) cannot navigate there on its own. Same shape as
 * `TerminalInputContext`: `null` outside the shell so the links that need
 * it can stay hidden there.
 */
export type OpenSettings = (section?: SectionId) => void

export const SettingsNavContext = createContext<OpenSettings | null>(null)

export function useOpenSettings(): OpenSettings | null {
  return useContext(SettingsNavContext)
}

import { createContext, useContext, useEffect, useRef } from 'react'
import type { CommandId } from '../shortcuts/commands'

export interface ShortcutsContextValue {
  /** Effective combo id for every command (default unless overridden). */
  bindings: Partial<Record<CommandId, string | null>>
  /** Called by whichever component currently owns a command's behavior; returns an unregister function. */
  registerHandler: (commandId: CommandId, handler: () => void) => () => void
  /** Fires a command's currently registered handler directly (no-op if nothing owns it) — lets the menu bar trigger the same action a shortcut would. */
  runCommand: (commandId: CommandId) => void
  setBinding: (commandId: CommandId, comboId: string | null) => void
  resetBinding: (commandId: CommandId) => void
  resetAllBindings: () => void
  /** Other command(s), if any, currently bound to this exact combo. */
  findConflicts: (comboId: string, excludingCommandId?: CommandId) => CommandId[]
  /** Pauses shortcut dispatch — used by the Settings recorder UI while it's capturing raw keystrokes. */
  setSuspended: (suspended: boolean) => void
}

const noop = (): void => {}

export const ShortcutsContext = createContext<ShortcutsContextValue>({
  bindings: {},
  registerHandler: () => noop,
  runCommand: noop,
  setBinding: noop,
  resetBinding: noop,
  resetAllBindings: noop,
  findConflicts: () => [],
  setSuspended: noop
})

export function useShortcuts(): ShortcutsContextValue {
  return useContext(ShortcutsContext)
}

/**
 * Lets a mounted component own a command's behavior for as long as it's
 * mounted. `handler` is read via a ref rather than depended on directly, so
 * passing a fresh inline closure every render doesn't churn the
 * register/unregister cycle — only a change of `commandId` does.
 */
export function useShortcutHandler(commandId: CommandId, handler: () => void): void {
  const { registerHandler } = useShortcuts()
  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  })
  useEffect(() => registerHandler(commandId, () => handlerRef.current()), [registerHandler, commandId])
}

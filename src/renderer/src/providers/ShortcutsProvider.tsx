import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { ShortcutsContext } from './ShortcutsContext'
import { COMMANDS, type CommandId } from '../shortcuts/commands'
import { comboIdFromEvent } from '../shortcuts/keyCombo'
import {
  effectiveCombo,
  readStoredShortcutOverrides,
  writeStoredShortcutOverrides,
  type ShortcutOverrides
} from '../shortcuts/shortcutBindings'

const COMMAND_IDS = Object.keys(COMMANDS) as CommandId[]
const PERSIST_DEBOUNCE_MS = 200

export default function ShortcutsProvider({ children }: { children: ReactNode }): ReactElement {
  const [overrides, setOverrides] = useState<ShortcutOverrides>(() => readStoredShortcutOverrides())

  const overridesRef = useRef(overrides)
  useEffect(() => {
    overridesRef.current = overrides
  }, [overrides])

  const handlersRef = useRef(new Map<CommandId, () => void>())
  const suspendedRef = useRef(false)

  useEffect(() => {
    const timer = setTimeout(() => writeStoredShortcutOverrides(overrides), PERSIST_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [overrides])

  useEffect(() => {
    const flush = (): void => writeStoredShortcutOverrides(overridesRef.current)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      flush()
    }
  }, [])

  const comboIndex = useMemo(() => {
    const map = new Map<string, CommandId>()
    for (const id of COMMAND_IDS) {
      const combo = effectiveCombo(id, overrides)
      if (combo) map.set(combo, id)
    }
    return map
  }, [overrides])
  const comboIndexRef = useRef(comboIndex)
  useEffect(() => {
    comboIndexRef.current = comboIndex
  }, [comboIndex])

  // Capture phase: fires before the event reaches whatever's focused (most
  // importantly the terminal, which otherwise swallows nearly every
  // keystroke) so a bound shortcut always wins. Only stops the event when
  // it actually matches a *currently handled* command — anything else falls
  // through untouched to normal typing.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (suspendedRef.current) return
      const comboId = comboIdFromEvent(e)
      if (!comboId) return
      const commandId = comboIndexRef.current.get(comboId)
      if (!commandId) return
      const handler = handlersRef.current.get(commandId)
      if (!handler) return
      e.preventDefault()
      e.stopPropagation()
      handler()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [])

  const registerHandler = useCallback((commandId: CommandId, handler: () => void): (() => void) => {
    handlersRef.current.set(commandId, handler)
    return () => {
      if (handlersRef.current.get(commandId) === handler) {
        handlersRef.current.delete(commandId)
      }
    }
  }, [])

  const runCommand = useCallback((commandId: CommandId) => {
    handlersRef.current.get(commandId)?.()
  }, [])

  const setBinding = useCallback((commandId: CommandId, comboId: string | null) => {
    setOverrides((prev) => ({ ...prev, [commandId]: comboId }))
  }, [])

  const resetBinding = useCallback((commandId: CommandId) => {
    setOverrides((prev) => {
      if (!(commandId in prev)) return prev
      const next = { ...prev }
      delete next[commandId]
      return next
    })
  }, [])

  const resetAllBindings = useCallback(() => setOverrides({}), [])

  const findConflicts = useCallback((comboId: string, excludingCommandId?: CommandId): CommandId[] => {
    return COMMAND_IDS.filter(
      (id) => id !== excludingCommandId && effectiveCombo(id, overridesRef.current) === comboId
    )
  }, [])

  const setSuspended = useCallback((suspended: boolean) => {
    suspendedRef.current = suspended
  }, [])

  const bindings = useMemo(() => {
    const result: Partial<Record<CommandId, string | null>> = {}
    for (const id of COMMAND_IDS) {
      result[id] = effectiveCombo(id, overrides)
    }
    return result
  }, [overrides])

  const value = useMemo(
    () => ({
      bindings,
      registerHandler,
      runCommand,
      setBinding,
      resetBinding,
      resetAllBindings,
      findConflicts,
      setSuspended
    }),
    [bindings, registerHandler, runCommand, setBinding, resetBinding, resetAllBindings, findConflicts, setSuspended]
  )

  return <ShortcutsContext.Provider value={value}>{children}</ShortcutsContext.Provider>
}

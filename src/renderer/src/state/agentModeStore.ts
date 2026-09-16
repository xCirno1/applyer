import { create } from 'zustand'
import { callIpc } from '../lib/ipcCall'
import { appError, type AppError } from '@shared/types/errorCodes'
import { isAgentMode, type AgentMode } from '@shared/types/agentMode'

/**
 * Which agent surface the shell shows (CLI's Terminal dock tab or
 * OpenRouter's chat panel on the right), mirrored from the one main-process
 * setting both modes share. `mode` is `null` until the first read comes
 * back, which `workspaceLayout.ts`'s `visibleDockTabs` and
 * `chatPanelAvailable` treat the same as `'cli'` (Terminal, no chat panel)
 * so nothing flickers while this loads.
 *
 * `setMode` is optimistic - the shell switches the instant the user picks a
 * mode rather than waiting on a round trip - and reverts on a rejected
 * write. The revert alone doesn't explain *why* to the user, so the failed
 * write's error is kept on `lastError` for a companion component (see
 * `App.tsx`'s `StartupWarningToast` for the same "AppError sitting in state
 * until something toasts it" shape) to surface as a toast and then clear.
 *
 * `subscribe` both loads the current mode and listens for
 * `onAgentModeChanged` - another window (or a settings screen this store
 * doesn't render) can flip the mode too, and every dock has to follow.
 */
interface AgentModeState {
  mode: AgentMode | null
  loading: boolean
  lastError: AppError | null
  load: () => Promise<void>
  setMode: (mode: AgentMode) => Promise<{ ok: boolean }>
  clearError: () => void
  subscribe: () => () => void
}

const BRIDGE_FAILURE_ERROR: AppError = appError('unexpected')

export const useAgentModeStore = create<AgentModeState>((set, get) => ({
  mode: null,
  loading: false,
  lastError: null,

  load: async () => {
    set({ loading: true })
    const result = await callIpc('settings.getAgentMode', () => window.api.settings.getAgentMode(), null)
    set({ mode: isAgentMode(result) ? result : get().mode, loading: false })
  },

  setMode: async (mode) => {
    const previous = get().mode
    if (previous === mode) return { ok: true }
    set({ mode, lastError: null })
    const result = await callIpc(
      'settings.setAgentMode',
      () => window.api.settings.setAgentMode(mode),
      { ok: false as const, error: BRIDGE_FAILURE_ERROR }
    )
    if (result.ok) {
      set({ mode: result.mode })
      return { ok: true }
    }
    set({ mode: previous, lastError: result.error })
    return { ok: false }
  },

  clearError: () => set({ lastError: null }),

  subscribe: () => {
    void get().load()
    return window.api.settings.onAgentModeChanged((next) => {
      if (isAgentMode(next)) set({ mode: next })
      else console.warn('Ignored malformed agent mode update', next)
    })
  }
}))

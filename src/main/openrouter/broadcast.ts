import type { WebContents } from 'electron'
import { IPC } from '@shared/types/ipcEvents'
import type { AgentMode } from '@shared/types/agentMode'
import type { OpenRouterAuthStatus } from '@shared/types/openrouter'

/**
 * Push channel for the two pieces of OpenRouter state the renderer needs
 * live rather than polled: the OAuth flow's status (`authFlow.ts` walks
 * through waiting -> exchanging -> connected/failed while the user is off
 * in their browser, with no request of its own to answer) and which agent
 * mode is active (settable from Settings, but also read by the shell, which
 * needs to know the moment it changes to swap the terminal dock tab for the
 * chat panel or back).
 *
 * Same shape as `ipc/jobsBroadcast.ts`: one module-level `WebContents`
 * reference, set once the main window exists, silently a no-op before that
 * or after the window is destroyed rather than throwing.
 */

let webContentsRef: WebContents | null = null

export function registerOpenRouterBroadcastTarget(webContents: WebContents): void {
  webContentsRef = webContents
}

export function broadcastOpenRouterAuthStatus(status: OpenRouterAuthStatus): void {
  if (webContentsRef && !webContentsRef.isDestroyed()) {
    webContentsRef.send(IPC.openrouter.onAuthStatus, status)
  }
}

export function broadcastAgentModeChanged(mode: AgentMode): void {
  if (webContentsRef && !webContentsRef.isDestroyed()) {
    webContentsRef.send(IPC.settings.onAgentModeChanged, mode)
  }
}

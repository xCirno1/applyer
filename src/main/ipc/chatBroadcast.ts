import type { WebContents } from 'electron'
import { IPC } from '@shared/types/ipcEvents'
import type { ChatStreamEvent } from '@shared/types/chat'

/**
 * Push channel for chat turns, mirroring `jobsBroadcast.ts`'s single-target
 * pattern: one main window, so one `WebContents` reference is enough, kept
 * module-level rather than threaded through every caller. `ChatStreamEvent`
 * is deliberately one wide union (see its doc comment in `shared/types/chat.ts`)
 * rather than a broadcast function per event kind: a streaming turn fires
 * many of these in quick succession, and giving each its own exported
 * function here would just restate the union at a second call site with no
 * way to keep the two in sync.
 */

let webContentsRef: WebContents | null = null

export function registerChatBroadcastTarget(webContents: WebContents): void {
  webContentsRef = webContents
}

export function broadcastChatEvent(event: ChatStreamEvent): void {
  if (webContentsRef && !webContentsRef.isDestroyed()) {
    webContentsRef.send(IPC.chat.onEvent, event)
  }
}

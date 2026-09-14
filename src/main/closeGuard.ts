import { IPC } from '@shared/types/ipcEvents'

/*
 * Keeps the window from closing over unsaved edits. The renderer is the
 * only side that knows whether a resume draft is dirty, so it reports the
 * aggregate flag here as it changes; when a close arrives while the flag
 * is up (the window's close button, File > Quit, Cmd+Q), the close is
 * cancelled and the renderer is told to ask. Its
 * own dialog answers with `confirmClose`, which lets the next close through.
 *
 * Cancelling the close also cancels an `app.quit()` in flight, which is the
 * point: a quit that got as far as the window is a close from here. The one
 * exit that must not be cancelled is a relaunch the user already committed
 * to (the storage move has rewritten its pointer, and an AppImage helper is
 * waiting for this process to go away); `release` lets that one through.
 */

export interface GuardableWindow {
  on(event: 'close', listener: (event: { preventDefault(): void }) => void): unknown
  webContents: { send(channel: string): void }
  close(): void
}

export interface CloseGuard {
  setUnsavedChanges(value: boolean): void
  hasUnsavedChanges(): boolean
  attach(window: GuardableWindow): void
  /** The renderer's dialog said to close anyway: the next close of that window is not questioned. */
  confirmClose(window: GuardableWindow): void
  /** Stops guarding altogether, for an exit that cannot be cancelled. */
  release(): void
}

export function createCloseGuard(): CloseGuard {
  let unsaved = false
  let released = false
  const confirmed = new WeakSet<GuardableWindow>()
  return {
    setUnsavedChanges(value) {
      unsaved = value
    },
    hasUnsavedChanges() {
      return unsaved
    },
    attach(window) {
      window.on('close', (event) => {
        if (!unsaved || released || confirmed.has(window)) return
        event.preventDefault()
        window.webContents.send(IPC.app.onCloseRequested)
      })
    },
    confirmClose(window) {
      confirmed.add(window)
      window.close()
    },
    release() {
      released = true
    }
  }
}

export const closeGuard = createCloseGuard()

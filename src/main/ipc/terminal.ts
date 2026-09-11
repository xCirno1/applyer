import { ipcMain, WebContents } from 'electron'
import { IPC, TerminalCreateOptions, TerminalCreateResult } from '@shared/types/ipcEvents'
import {
  createSession,
  writeToSession,
  resizeSession,
  disposeSession
} from '../terminal/ptyManager'

/**
 * Split into "register the handlers" and "point them at a window" for the
 * same reason `jobsBroadcast` is: handlers belong to the process and can only
 * be registered once (`ipcMain.handle` throws on a second handler for a
 * channel, and `ipcMain.on` would silently stack a duplicate listener that
 * writes every keystroke to the pty twice), while the window they talk to
 * comes and goes — on macOS the app outlives its last window and builds a new
 * one on `activate`.
 *
 * The target is read at send time rather than captured when a session is
 * created, so output from a session that outlived a window reaches the
 * current one instead of a destroyed `WebContents`.
 */
let target: WebContents | null = null

export function setTerminalTarget(webContents: WebContents): void {
  target = webContents
}

function sendToRenderer(channel: string, payload: unknown): void {
  if (target && !target.isDestroyed()) {
    target.send(channel, payload)
  }
}

export function registerTerminalIpc(): void {
  ipcMain.handle(
    IPC.terminal.create,
    (_event, options: TerminalCreateOptions): TerminalCreateResult => {
      const cols = Number.isFinite(options?.cols) ? options.cols : 80
      const rows = Number.isFinite(options?.rows) ? options.rows : 24

      const sessionId = createSession(
        cols,
        rows,
        (data) => sendToRenderer(IPC.terminal.onData, { sessionId, data }),
        (exitCode) => sendToRenderer(IPC.terminal.onExit, { sessionId, exitCode })
      )

      return { sessionId }
    }
  )

  ipcMain.on(IPC.terminal.write, (_event, sessionId: string, data: string) => {
    if (typeof sessionId !== 'string' || typeof data !== 'string') return
    writeToSession(sessionId, data)
  })

  ipcMain.on(IPC.terminal.resize, (_event, sessionId: string, cols: number, rows: number) => {
    if (typeof sessionId !== 'string') return
    resizeSession(sessionId, Number(cols), Number(rows))
  })

  ipcMain.on(IPC.terminal.dispose, (_event, sessionId: string) => {
    if (typeof sessionId !== 'string') return
    disposeSession(sessionId)
  })
}

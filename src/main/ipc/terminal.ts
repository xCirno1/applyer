import { ipcMain, WebContents } from 'electron'
import { IPC, TerminalCreateOptions, TerminalCreateResult } from '@shared/types/ipcEvents'
import {
  createSession,
  writeToSession,
  resizeSession,
  disposeSession
} from '../terminal/ptyManager'

export function registerTerminalIpc(webContents: WebContents): void {
  ipcMain.handle(
    IPC.terminal.create,
    (_event, options: TerminalCreateOptions): TerminalCreateResult => {
      const cols = Number.isFinite(options?.cols) ? options.cols : 80
      const rows = Number.isFinite(options?.rows) ? options.rows : 24

      const sessionId = createSession(
        cols,
        rows,
        (data) => {
          if (!webContents.isDestroyed()) {
            webContents.send(IPC.terminal.onData, { sessionId, data })
          }
        },
        (exitCode) => {
          if (!webContents.isDestroyed()) {
            webContents.send(IPC.terminal.onExit, { sessionId, exitCode })
          }
        }
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

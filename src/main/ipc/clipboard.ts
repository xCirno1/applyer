import { clipboard, ipcMain } from 'electron'
import { IPC } from '@shared/types/ipcEvents'

/**
 * OS clipboard access for the terminal's copy/paste keys.
 *
 * The renderer is sandboxed and loaded from a file:// origin, where
 * `navigator.clipboard.readText()` depends on a permission grant and on the
 * document holding focus. Electron's own clipboard module has neither
 * constraint, so both directions go through the main process and behave the
 * same on every platform.
 */
export function registerClipboardIpc(): void {
  ipcMain.handle(IPC.clipboard.readText, (): string => clipboard.readText())

  ipcMain.on(IPC.clipboard.writeText, (_event, text: string) => {
    if (typeof text !== 'string' || text.length === 0) return
    clipboard.writeText(text)
  })
}

import { app, BrowserWindow, ipcMain } from 'electron'
import { IPC, type AppInfo } from '@shared/types/ipcEvents'
import { closeGuard } from '../closeGuard'

export function registerAppIpc(): void {
  ipcMain.handle(
    IPC.app.getInfo,
    (): AppInfo => ({
      version: app.getVersion(),
      isDevBuild: !app.isPackaged,
      userDataDir: app.getPath('userData')
    })
  )

  // Anything but a literal true reads as "nothing unsaved": a malformed
  // report must never leave the window unable to close.
  ipcMain.on(IPC.app.setUnsavedChanges, (_event, value: unknown) => {
    closeGuard.setUnsavedChanges(value === true)
  })

  ipcMain.on(IPC.app.confirmClose, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window) closeGuard.confirmClose(window)
  })
}

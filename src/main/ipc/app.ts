import { app, ipcMain } from 'electron'
import { IPC, type AppInfo } from '@shared/types/ipcEvents'

export function registerAppIpc(): void {
  ipcMain.handle(
    IPC.app.getInfo,
    (): AppInfo => ({
      version: app.getVersion(),
      isDevBuild: !app.isPackaged,
      userDataDir: app.getPath('userData')
    })
  )
}

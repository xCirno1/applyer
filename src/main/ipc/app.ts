import { app, ipcMain } from 'electron'
import { IPC } from '@shared/types/ipcEvents'

export function registerAppIpc(): void {
  ipcMain.handle(IPC.app.getVersion, () => app.getVersion())
}

import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import './logger'
import { appLogger } from './logger'
import { registerJobHuntFileProtocol } from './protocols'
import { createMainWindow } from './window'
import { initDatabase, closeDatabase } from './db'
import { registerTerminalIpc } from './ipc/terminal'
import { registerJobsIpc } from './ipc/jobs'
import { registerProfileIpc } from './ipc/profile'
import { registerOnboardingIpc } from './ipc/onboarding'
import { registerBrowserControlIpc } from './ipc/browserControl'
import { registerSettingsIpc } from './ipc/settings'
import { registerLogsIpc } from './ipc/logs'
import { registerJobsBroadcastTarget } from './ipc/jobsBroadcast'
import { disposeAllSessions } from './terminal/ptyManager'
import { applyProductionCsp } from './security'
import { startMcpSocketServer } from './mcp-server/transportSocket'
import { closeAllBrowsers } from './browser/browserController'
import { mcpSocketPath } from './config/paths'
import { reconcileOrphanedBlockedJobs } from './jobActions'

let mcpSocketServer: ReturnType<typeof startMcpSocketServer> | undefined

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.jobhunt.app')

  if (!is.dev) {
    applyProductionCsp()
  }

  registerJobHuntFileProtocol()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  try {
    initDatabase()
  } catch (err) {
    appLogger.error(`Database initialization failed: ${String(err)}`)
    app.quit()
    return
  }

  reconcileOrphanedBlockedJobs()

  registerJobsIpc()
  registerProfileIpc()
  registerOnboardingIpc()
  registerBrowserControlIpc()
  registerSettingsIpc()
  registerLogsIpc()

  mcpSocketServer = startMcpSocketServer(mcpSocketPath())

  const mainWindow = createMainWindow()
  registerTerminalIpc(mainWindow.webContents)
  registerJobsBroadcastTarget(mainWindow.webContents)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const window = createMainWindow()
      registerTerminalIpc(window.webContents)
      registerJobsBroadcastTarget(window.webContents)
    }
  })
})

app.on('window-all-closed', () => {
  disposeAllSessions()
  closeDatabase()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  disposeAllSessions()
  mcpSocketServer?.close()
  void closeAllBrowsers()
})
